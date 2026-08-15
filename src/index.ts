import 'dotenv/config';
import { createPublicClient, createWalletClient, formatEther, http, parseEther, watchBlockNumber, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { ADDRESSES } from './addresses.js';
import { AAVE_POOL_ABI, ERC20_ABI, EXECUTOR_ABI } from './abis.js';
import { adaptiveCandidateSizes, loadV2Pool, quoteFromPool, type V2Pool } from './quote.js';
import { PendingNonceManager } from './nonce.js';
import { PAIRS, VENUES, venueByRouter, type V2Venue } from './venues.js';

const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
const dryRun = (process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const executor = process.env.EXECUTOR_ADDRESS as Address | undefined;
const targetProfit = parseEther(process.env.TARGET_PROFIT_WETH || '0.0001');
const eventPollMs = Number(process.env.EVENT_POLL_MS || '250');
const slippageBps = BigInt(process.env.SLIPPAGE_BPS || '30');
const gasSafetyBps = BigInt(process.env.GAS_SAFETY_BPS || '12500');
const maxGasLimit = BigInt(process.env.MAX_GAS_LIMIT || '1500000');
const maxGasCostWeth = parseEther(process.env.MAX_GAS_COST_WETH || '0.01');
const deadlineSeconds = BigInt(process.env.DEADLINE_SECONDS || '8');
const maxPriceImpactBps = BigInt(process.env.MAX_PRICE_IMPACT_BPS || '2000');
const minCandidateWeth = parseEther(process.env.MIN_CANDIDATE_WETH || '0.01');
const maxPendingTxs = Number(process.env.MAX_PENDING_TXS || '2');

const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });

type PoolKey = `${string}:${string}:${string}`;
type Opportunity = {
  amount: bigint; first: bigint; final: bigint; expectedProfit: bigint; estimatedPremium: bigint;
  routerA: Address; routerB: Address; pathA: Address[]; pathB: Address[]; pairId: string; blockNumber: bigint; priceImpactBps: bigint;
};

function minOut(amount: bigint): bigint {
  if (slippageBps >= 10_000n) throw new Error('SLIPPAGE_BPS must be below 10000');
  return (amount * (10_000n - slippageBps)) / 10_000n;
}
function assertAddress(value: string | undefined, name: string): asserts value is Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${name} is missing or invalid`);
}
function poolKey(venue: V2Venue, tokenIn: Address, tokenOut: Address): PoolKey { return `${venue.id}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`; }

async function flashPremiumBps(): Promise<bigint> {
  return BigInt(await publicClient.readContract({ address: ADDRESSES.aavePool, abi: AAVE_POOL_ABI, functionName: 'FLASHLOAN_PREMIUM_TOTAL' }));
}

async function loadPools(blockNumber: bigint): Promise<Map<PoolKey, { venue: V2Venue; pool: V2Pool }>> {
  const requests = VENUES.flatMap((venue) => PAIRS.map(async (pair) => {
    const pool = await loadV2Pool(publicClient, venue, ADDRESSES.weth, pair.token, blockNumber);
    return pool ? { key: poolKey(venue, ADDRESSES.weth, pair.token), venue, pool } : null;
  }));
  const loaded = await Promise.all(requests);
  return new Map(loaded.filter((item): item is NonNullable<typeof item> => item !== null).map((item) => [item.key, { venue: item.venue, pool: item.pool }]));
}

async function findOpportunity(blockNumber: bigint): Promise<Opportunity | null> {
  const [premiumBps, poolLiquidity, pools] = await Promise.all([
    flashPremiumBps(),
    publicClient.readContract({ address: ADDRESSES.weth, abi: ERC20_ABI, functionName: 'balanceOf', args: [ADDRESSES.aavePool], blockNumber }),
    loadPools(blockNumber),
  ]);
  let best: Opportunity | null = null;

  for (const pair of PAIRS) {
    for (const venueA of VENUES) {
      const firstPool = pools.get(poolKey(venueA, ADDRESSES.weth, pair.token));
      if (!firstPool) continue;
      const candidates = adaptiveCandidateSizes(poolLiquidity, firstPool.pool.reserveIn, minCandidateWeth, maxPriceImpactBps);
      for (const venueB of VENUES) {
        if (venueB.id === venueA.id) continue;
        const secondPool = pools.get(poolKey(venueB, ADDRESSES.weth, pair.token));
        if (!secondPool) continue;
        for (const amount of candidates) {
          const first = quoteFromPool(firstPool.pool, venueA.feeBps, amount);
          if (!first || first.priceImpactBps > maxPriceImpactBps) continue;
          const reversePool: V2Pool = { ...secondPool.pool, tokenIn: pair.token, tokenOut: ADDRESSES.weth, reserveIn: secondPool.pool.reserveOut, reserveOut: secondPool.pool.reserveIn };
          const second = quoteFromPool(reversePool, venueB.feeBps, first.amountOut);
          if (!second || second.priceImpactBps > maxPriceImpactBps) continue;
          const estimatedPremium = (amount * premiumBps + 9_999n) / 10_000n;
          const expectedProfit = second.amountOut > amount + estimatedPremium ? second.amountOut - amount - estimatedPremium : 0n;
          if (expectedProfit < targetProfit) continue;
          if (!best || expectedProfit > best.expectedProfit) best = {
            amount, first: first.amountOut, final: second.amountOut, expectedProfit, estimatedPremium,
            routerA: venueA.router, routerB: venueB.router, pathA: [ADDRESSES.weth, pair.token], pathB: [pair.token, ADDRESSES.weth],
            pairId: pair.id, blockNumber, priceImpactBps: first.priceImpactBps + second.priceImpactBps,
          };
        }
      }
    }
  }
  return best;
}

async function estimateGasCost(account: Address, opportunity: Opportunity, minProfit: bigint, deadline: bigint) {
  assertAddress(executor, 'EXECUTOR_ADDRESS');
  const args = [ADDRESSES.weth, opportunity.amount, opportunity.routerA, opportunity.pathA, minOut(opportunity.first), opportunity.routerB, opportunity.pathB, minOut(opportunity.final), minProfit, deadline] as const;
  const gas = await publicClient.estimateContractGas({ account, address: executor, abi: EXECUTOR_ABI, functionName: 'startArbitrage', args });
  if (gas > maxGasLimit) throw new Error(`gas estimate ${gas} exceeds MAX_GAS_LIMIT`);
  const gasPrice = await publicClient.getGasPrice();
  const gasCost = (gas * gasPrice * gasSafetyBps) / 10_000n;
  if (gasCost > maxGasCostWeth) throw new Error(`gas reserve ${formatEther(gasCost)} WETH exceeds MAX_GAS_COST_WETH`);
  return { gas, gasCost };
}

const pending = new Set<Hex>();
const nonceManager = new PendingNonceManager(() => publicClient.getTransactionCount({ address: process.env.SIGNER_ADDRESS as Address, blockTag: 'pending' }));

async function submitWithManagedNonce(walletClient: ReturnType<typeof createWalletClient>, request: Parameters<typeof walletClient.writeContract>[0]): Promise<Hex> {
  const nonce = await nonceManager.reserve();
  try {
    const hash = await walletClient.writeContract({ ...request, nonce });
    pending.add(hash);
    void publicClient.waitForTransactionReceipt({ hash }).then(() => pending.delete(hash), () => pending.delete(hash));
    return hash;
  } catch (error) {
    nonceManager.reset();
    throw error;
  }
}

async function executeOpportunity(opportunity: Opportunity) {
  assertAddress(executor, 'EXECUTOR_ADDRESS');
  const simulationKey = process.env.PRIVATE_KEY || process.env.SIMULATION_ACCOUNT;
  if (!simulationKey) throw new Error(dryRun ? 'SIMULATION_ACCOUNT or PRIVATE_KEY is required when EXECUTOR_ADDRESS is set' : 'PRIVATE_KEY is required when DRY_RUN=false');
  const isPrivateKey = simulationKey.startsWith('0x') && simulationKey.length === 66;
  const account = isPrivateKey ? privateKeyToAccount(simulationKey as Hex) : ({ address: simulationKey as Address } as ReturnType<typeof privateKeyToAccount>);
  if (!process.env.SIGNER_ADDRESS) process.env.SIGNER_ADDRESS = account.address;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + deadlineSeconds;
  const { gas, gasCost } = await estimateGasCost(account.address, opportunity, targetProfit, deadline);
  const requiredProfitFloor = targetProfit + gasCost;
  if (opportunity.expectedProfit < requiredProfitFloor) { console.log('skip: spread does not cover target profit + gas reserve'); return; }

  const latestBlock = await publicClient.getBlockNumber();
  if (latestBlock !== opportunity.blockNumber) { console.log(`skip: quote stale (${opportunity.blockNumber} -> ${latestBlock})`); return; }
  const simulation = await publicClient.simulateContract({
    account: account.address, address: executor, abi: EXECUTOR_ABI, functionName: 'startArbitrage',
    args: [ADDRESSES.weth, opportunity.amount, opportunity.routerA, opportunity.pathA, minOut(opportunity.first), opportunity.routerB, opportunity.pathB, minOut(opportunity.final), requiredProfitFloor, deadline],
    blockNumber: opportunity.blockNumber,
  });
  if (dryRun) { console.log(`DRY RUN: simulation passed | pair=${opportunity.pairId} size=${formatEther(opportunity.amount)} WETH gas=${gas} reserve=${formatEther(gasCost)} WETH`); return; }
  if (pending.size >= maxPendingTxs) { console.log(`skip: ${pending.size} transactions already pending`); return; }
  if (!isPrivateKey) throw new Error('PRIVATE_KEY is required when DRY_RUN=false');
  const walletClient = createWalletClient({ account, chain: arbitrum, transport: http(rpcUrl) });
  const hash = await submitWithManagedNonce(walletClient, simulation.request);
  console.log('submitted', hash, 'pending=', pending.size);
}

let scanInFlight = false;
async function scanBlock(blockNumber: bigint) {
  if (scanInFlight) return;
  scanInFlight = true;
  try {
    const opportunity = await findOpportunity(blockNumber);
    if (opportunity && executor) {
      console.log({ pair: opportunity.pairId, amount: formatEther(opportunity.amount), expectedFinal: formatEther(opportunity.final), expectedProfitAfterPremium: formatEther(opportunity.expectedProfit), premium: formatEther(opportunity.estimatedPremium), priceImpactBps: opportunity.priceImpactBps.toString(), route: `${venueByRouter(opportunity.routerA)?.id} -> ${venueByRouter(opportunity.routerB)?.id}`, block: opportunity.blockNumber.toString() });
      await executeOpportunity(opportunity);
    }
  } catch (error) { console.error('scan cycle failed:', error instanceof Error ? error.message : error); }
  finally { scanInFlight = false; }
}

async function main() {
  console.log(`ArbiFlash-MEV | chain=${ADDRESSES.chainId} dryRun=${dryRun} venues=${VENUES.length} pairs=${PAIRS.length}`);
  const initialBlock = await publicClient.getBlockNumber();
  await scanBlock(initialBlock);
  watchBlockNumber(publicClient, { emitMissed: true, emitOnBegin: false, pollingInterval: eventPollMs, onBlockNumber: (blockNumber) => { void scanBlock(blockNumber); } });
}

void main().catch((error) => { console.error(error); process.exit(1); });

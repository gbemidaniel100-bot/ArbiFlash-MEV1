import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { ADDRESSES } from './addresses.js';
import { AAVE_POOL_ABI, ERC20_ABI, EXECUTOR_ABI, V2_ROUTER_ABI } from './abis.js';

const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
const dryRun = (process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const executor = process.env.EXECUTOR_ADDRESS as Address | undefined;
const targetProfit = parseEther(process.env.TARGET_PROFIT_WETH || '0.0001');
const pollMs = Number(process.env.POLL_MS || 1500);
const slippageBps = BigInt(process.env.SLIPPAGE_BPS || '30');
const gasSafetyBps = BigInt(process.env.GAS_SAFETY_BPS || '12500');
const maxGasLimit = BigInt(process.env.MAX_GAS_LIMIT || '1500000');
const amounts = (process.env.CANDIDATE_AMOUNTS_WETH || '0.05,0.1,0.25,0.5,1,2,5')
  .split(',')
  .map((value) => parseEther(value.trim()))
  .filter((value) => value > 0n);

const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });

function minOut(amount: bigint): bigint {
  if (slippageBps >= 10_000n) throw new Error('SLIPPAGE_BPS must be below 10000');
  return (amount * (10_000n - slippageBps)) / 10_000n;
}

function assertAddress(value: string | undefined, name: string): asserts value is Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${name} is missing or invalid`);
}

async function quote(router: Address, amountIn: bigint, path: Address[]): Promise<bigint> {
  const result = await publicClient.readContract({
    address: router,
    abi: V2_ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
  });
  return result[result.length - 1];
}

async function flashPremiumBps(): Promise<bigint> {
  const premium = await publicClient.readContract({
    address: ADDRESSES.aavePool,
    abi: AAVE_POOL_ABI,
    functionName: 'FLASHLOAN_PREMIUM_TOTAL',
  });
  return BigInt(premium);
}

async function estimateGasCost(
  account: Address,
  opportunity: NonNullable<Awaited<ReturnType<typeof findOpportunity>>>,
  minProfit: bigint,
): Promise<{ gas: bigint; gasCost: bigint }> {
  assertAddress(executor, 'EXECUTOR_ADDRESS');
  const args = [
    ADDRESSES.weth,
    opportunity.amount,
    opportunity.routerA,
    opportunity.pathA,
    minOut(opportunity.first),
    opportunity.routerB,
    opportunity.pathB,
    minOut(opportunity.final),
    minProfit,
  ] as const;

  const gas = await publicClient.estimateContractGas({
    account,
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: 'startArbitrage',
    args,
  });
  if (gas > maxGasLimit) throw new Error(`gas estimate ${gas} exceeds MAX_GAS_LIMIT`);

  const gasPrice = await publicClient.getGasPrice();
  const gasCost = (gas * gasPrice * gasSafetyBps) / 10_000n;
  return { gas, gasCost };
}

async function findOpportunity() {
  const premiumBps = await flashPremiumBps();
  const poolLiquidity = await publicClient.readContract({
    address: ADDRESSES.weth,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ADDRESSES.aavePool],
  });

  const paths = [
    { routerA: ADDRESSES.camelotV2, routerB: ADDRESSES.uniswapV2 },
    { routerA: ADDRESSES.uniswapV2, routerB: ADDRESSES.camelotV2 },
  ] as const;

  let best: {
    amount: bigint;
    first: bigint;
    final: bigint;
    expectedProfit: bigint;
    estimatedPremium: bigint;
    routerA: Address;
    routerB: Address;
    pathA: Address[];
    pathB: Address[];
  } | null = null;

  for (const amount of amounts) {
    if (amount > poolLiquidity) continue;
    for (const route of paths) {
      try {
        const first = await quote(route.routerA, amount, [ADDRESSES.weth, ADDRESSES.usdc]);
        const final = await quote(route.routerB, first, [ADDRESSES.usdc, ADDRESSES.weth]);
        const estimatedPremium = (amount * premiumBps + 9_999n) / 10_000n;
        const expectedProfit = final - amount - estimatedPremium;
        if (expectedProfit >= targetProfit && (!best || expectedProfit > best.expectedProfit)) {
          best = {
            amount,
            first,
            final,
            expectedProfit,
            estimatedPremium,
            routerA: route.routerA,
            routerB: route.routerB,
            pathA: [ADDRESSES.weth, ADDRESSES.usdc],
            pathB: [ADDRESSES.usdc, ADDRESSES.weth],
          };
        }
      } catch (error) {
        console.warn('quote failed', error instanceof Error ? error.message : error);
      }
    }
  }
  return best;
}

async function executeOpportunity(opportunity: NonNullable<Awaited<ReturnType<typeof findOpportunity>>>) {
  assertAddress(executor, 'EXECUTOR_ADDRESS');
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY is required when DRY_RUN=false');

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
  const { gas, gasCost } = await estimateGasCost(account.address, opportunity, targetProfit);
  const requiredProfitFloor = targetProfit + gasCost;

  if (opportunity.expectedProfit < requiredProfitFloor) {
    console.log('skip: spread does not cover target profit + gas safety reserve');
    return;
  }

  const simulation = await publicClient.simulateContract({
    account,
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: 'startArbitrage',
    args: [
      ADDRESSES.weth,
      opportunity.amount,
      opportunity.routerA,
      opportunity.pathA,
      minOut(opportunity.first),
      opportunity.routerB,
      opportunity.pathB,
      minOut(opportunity.final),
      requiredProfitFloor,
    ],
  });

  if (dryRun) {
    console.log(`DRY RUN: simulation passed | gas=${gas} reserve=${formatEther(gasCost)} WETH`);
    return;
  }

  const walletClient = createWalletClient({ account, chain: arbitrum, transport: http(rpcUrl) });
  const hash = await walletClient.writeContract(simulation.request);
  console.log('submitted', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('confirmed', receipt.status, receipt.transactionHash);
}

async function main() {
  console.log(`ArbiFlash-MEV | chain=${ADDRESSES.chainId} dryRun=${dryRun}`);
  console.log(`executor=${executor ?? 'not deployed'} targetProfit=${formatEther(targetProfit)} WETH`);

  while (true) {
    try {
      const opportunity = await findOpportunity();
      if (opportunity) {
        console.log({
          amount: formatEther(opportunity.amount),
          expectedFinal: formatEther(opportunity.final),
          expectedProfitAfterPremium: formatEther(opportunity.expectedProfit),
          premium: formatEther(opportunity.estimatedPremium),
          route: `${opportunity.routerA} -> ${opportunity.routerB}`,
        });
        if (executor) await executeOpportunity(opportunity);
      }
    } catch (error) {
      console.error('scan cycle failed:', error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

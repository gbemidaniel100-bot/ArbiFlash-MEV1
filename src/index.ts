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
import { EXECUTOR_ABI, V2_ROUTER_ABI } from './abis.js';

const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
const dryRun = (process.env.DRY_RUN || 'true').toLowerCase() === 'true';
const executor = process.env.EXECUTOR_ADDRESS as Address | undefined;
const minProfit = parseEther(process.env.MIN_PROFIT_WETH || '0.0001');
const pollMs = Number(process.env.POLL_MS || 1500);
const slippageBps = BigInt(process.env.SLIPPAGE_BPS || '50');
const amounts = (process.env.CANDIDATE_AMOUNTS_WETH || '0.1,0.25,0.5,1,2')
  .split(',')
  .map((value) => parseEther(value.trim()));

const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });

function minOut(amount: bigint): bigint {
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

async function findOpportunity() {
  for (const amount of amounts) {
    try {
      const first = await quote(ADDRESSES.camelotV2, amount, [ADDRESSES.weth, ADDRESSES.usdc]);
      const final = await quote(ADDRESSES.uniswapV2, first, [ADDRESSES.usdc, ADDRESSES.weth]);
      const expectedProfit = final - amount;
      if (expectedProfit >= minProfit) {
        return {
          amount,
          first,
          final,
          expectedProfit,
          routerA: ADDRESSES.camelotV2,
          routerB: ADDRESSES.uniswapV2,
          pathA: [ADDRESSES.weth, ADDRESSES.usdc],
          pathB: [ADDRESSES.usdc, ADDRESSES.weth],
        } as const;
      }
    } catch (error) {
      console.warn('quote failed', error instanceof Error ? error.message : error);
    }
  }
  return null;
}

async function executeOpportunity(opportunity: NonNullable<Awaited<ReturnType<typeof findOpportunity>>>) {
  assertAddress(executor, 'EXECUTOR_ADDRESS');
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY is required when DRY_RUN=false');

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
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
      minProfit,
    ],
  });

  if (dryRun) {
    console.log('DRY RUN: simulation passed; no transaction sent.');
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
  console.log(`executor=${executor ?? 'not deployed'} minProfit=${formatEther(minProfit)} WETH`);

  while (true) {
    const opportunity = await findOpportunity();
    if (opportunity) {
      console.log({
        amount: formatEther(opportunity.amount),
        expectedFinal: formatEther(opportunity.final),
        expectedProfit: formatEther(opportunity.expectedProfit),
      });
      if (executor) {
        try {
          await executeOpportunity(opportunity);
        } catch (error) {
          console.error('execution rejected:', error instanceof Error ? error.message : error);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

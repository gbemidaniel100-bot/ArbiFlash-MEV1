import { zeroAddress, type Address, type PublicClient } from 'viem';
import { V2_FACTORY_ABI, V2_PAIR_ABI } from './abis.js';
import type { V2Venue } from './venues.js';

export type ReserveQuote = {
  amountIn: bigint;
  amountOut: bigint;
  pair: Address;
  reserveIn: bigint;
  reserveOut: bigint;
  priceImpactBps: bigint;
};

export async function quoteV2(
  client: PublicClient,
  venue: V2Venue,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<ReserveQuote | null> {
  if (amountIn <= 0n) return null;
  const pair = await client.readContract({ address: venue.factory, abi: V2_FACTORY_ABI, functionName: 'getPair', args: [tokenIn, tokenOut] });
  if (pair === zeroAddress) return null;

  const [token0, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'token0' }),
    client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'getReserves' }),
  ]);
  const reserve0 = reserves[0];
  const reserve1 = reserves[1];
  const reserveIn = token0.toLowerCase() === tokenIn.toLowerCase() ? reserve0 : reserve1;
  const reserveOut = token0.toLowerCase() === tokenIn.toLowerCase() ? reserve1 : reserve0;
  if (reserveIn === 0n || reserveOut === 0n) return null;

  const feeFactor = 10_000n - venue.feeBps;
  const amountInWithFee = amountIn * feeFactor;
  const denominator = reserveIn * 10_000n + amountInWithFee;
  const amountOut = (amountInWithFee * reserveOut) / denominator;
  if (amountOut === 0n) return null;

  const spotNumerator = amountIn * reserveOut;
  const spotDenominator = reserveIn;
  const idealOut = spotNumerator / spotDenominator;
  const priceImpactBps = idealOut > 0n && idealOut > amountOut
    ? ((idealOut - amountOut) * 10_000n) / idealOut
    : 0n;

  return { amountIn, amountOut, pair, reserveIn, reserveOut, priceImpactBps };
}

export function adaptiveCandidateSizes(maxAmount: bigint, reserveIn: bigint, minAmount: bigint, maxImpactBps: bigint): bigint[] {
  if (maxAmount <= 0n || reserveIn <= 0n) return [];
  const liquidityCap = (reserveIn * maxImpactBps) / 10_000n;
  const cap = maxAmount < liquidityCap ? maxAmount : liquidityCap;
  if (cap < minAmount) return [];
  const fractions = [100n, 200n, 400n, 800n, 1200n, 1600n, 2000n];
  const candidates = new Set<bigint>([minAmount, cap]);
  for (const bps of fractions) {
    const size = (cap * bps) / 10_000n;
    if (size >= minAmount && size <= cap) candidates.add(size);
  }
  return [...candidates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

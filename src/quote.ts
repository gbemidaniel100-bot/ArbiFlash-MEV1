import { zeroAddress, type Address, type PublicClient } from 'viem';
import { V2_FACTORY_ABI, V2_PAIR_ABI } from './abis.js';
import type { V2Venue } from './venues.js';

export type V2Pool = { pair: Address; tokenIn: Address; tokenOut: Address; reserveIn: bigint; reserveOut: bigint };
export type ReserveQuote = { amountIn: bigint; amountOut: bigint; pair: Address; reserveIn: bigint; reserveOut: bigint; priceImpactBps: bigint };

export async function loadV2Pool(client: PublicClient, venue: V2Venue, tokenIn: Address, tokenOut: Address): Promise<V2Pool | null> {
  const pair = await client.readContract({ address: venue.factory, abi: V2_FACTORY_ABI, functionName: 'getPair', args: [tokenIn, tokenOut] });
  if (pair === zeroAddress) return null;
  const [token0, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'token0' }),
    client.readContract({ address: pair, abi: V2_PAIR_ABI, functionName: 'getReserves' }),
  ]);
  const reserveIn = token0.toLowerCase() === tokenIn.toLowerCase() ? reserves[0] : reserves[1];
  const reserveOut = token0.toLowerCase() === tokenIn.toLowerCase() ? reserves[1] : reserves[0];
  if (reserveIn === 0n || reserveOut === 0n) return null;
  return { pair, tokenIn, tokenOut, reserveIn, reserveOut };
}

export function quoteFromPool(pool: V2Pool, feeBps: bigint, amountIn: bigint): ReserveQuote | null {
  if (amountIn <= 0n || pool.reserveIn === 0n || pool.reserveOut === 0n) return null;
  const feeFactor = 10_000n - feeBps;
  const amountInWithFee = amountIn * feeFactor;
  const denominator = pool.reserveIn * 10_000n + amountInWithFee;
  const amountOut = (amountInWithFee * pool.reserveOut) / denominator;
  if (amountOut === 0n) return null;
  const idealOut = (amountIn * pool.reserveOut) / pool.reserveIn;
  const priceImpactBps = idealOut > amountOut ? ((idealOut - amountOut) * 10_000n) / idealOut : 0n;
  return { amountIn, amountOut, pair: pool.pair, reserveIn: pool.reserveIn, reserveOut: pool.reserveOut, priceImpactBps };
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

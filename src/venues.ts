import type { Address } from 'viem';
import { ADDRESSES } from './addresses.js';

export type V2Venue = {
  id: string;
  router: Address;
  factory: Address;
  feeBps: bigint;
};

export type PairSpec = { id: string; token: Address; symbol: string };

export const VENUES: readonly V2Venue[] = [
  { id: 'camelot-v2', router: ADDRESSES.camelotV2, factory: ADDRESSES.camelotFactory, feeBps: 30n },
  { id: 'uniswap-v2', router: ADDRESSES.uniswapV2, factory: ADDRESSES.uniswapV2Factory, feeBps: 30n },
  { id: 'sushiswap-v2', router: ADDRESSES.sushiV2, factory: ADDRESSES.sushiV2Factory, feeBps: 30n },
];

export const PAIRS: readonly PairSpec[] = [
  { id: 'WETH/USDC', token: ADDRESSES.usdc, symbol: 'USDC' },
  { id: 'WETH/USDT', token: ADDRESSES.usdt, symbol: 'USDT' },
];

export function venueByRouter(router: Address): V2Venue | undefined {
  return VENUES.find((venue) => venue.router.toLowerCase() === router.toLowerCase());
}

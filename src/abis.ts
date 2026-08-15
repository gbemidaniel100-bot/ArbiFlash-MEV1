export const V2_ROUTER_ABI = [
  { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
] as const;

export const V2_FACTORY_ABI = [
  { type: 'function', name: 'getPair', stateMutability: 'view', inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }], outputs: [{ name: 'pair', type: 'address' }] },
] as const;

export const V2_PAIR_ABI = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'blockTimestampLast', type: 'uint32' }] },
] as const;

export const AAVE_POOL_ABI = [{ type: 'function', name: 'FLASHLOAN_PREMIUM_TOTAL', stateMutability: 'view', inputs: [], outputs: [{ name: 'premiumTotal', type: 'uint128' }] }] as const;

export const ERC20_ABI = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] }] as const;

export const EXECUTOR_ABI = [{
  type: 'function', name: 'startArbitrage', stateMutability: 'nonpayable',
  inputs: [
    { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'routerA', type: 'address' }, { name: 'pathA', type: 'address[]' }, { name: 'minOutA', type: 'uint256' },
    { name: 'routerB', type: 'address' }, { name: 'pathB', type: 'address[]' }, { name: 'minOutB', type: 'uint256' },
    { name: 'minProfit', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ], outputs: [],
}] as const;

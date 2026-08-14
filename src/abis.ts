export const V2_ROUTER_ABI = [
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

export const EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'startArbitrage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'routerA', type: 'address' },
      { name: 'pathA', type: 'address[]' },
      { name: 'minOutA', type: 'uint256' },
      { name: 'routerB', type: 'address' },
      { name: 'pathB', type: 'address[]' },
      { name: 'minOutB', type: 'uint256' },
      { name: 'minProfit', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export function isQuoteFresh(quoteBlock: bigint, latestBlock: bigint): boolean {
  return quoteBlock === latestBlock;
}

export function requiredProfitFloor(targetProfit: bigint, gasReserve: bigint): bigint {
  return targetProfit + gasReserve;
}

export function isEconomicallyExecutable(expectedProfit: bigint, targetProfit: bigint, gasReserve: bigint, maxGasReserve: bigint): boolean {
  return gasReserve <= maxGasReserve && expectedProfit >= requiredProfitFloor(targetProfit, gasReserve);
}

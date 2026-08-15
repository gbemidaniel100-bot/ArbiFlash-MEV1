import { expect } from 'chai';
import { adaptiveCandidateSizes, loadV2Pool, quoteFromPool, type V2Pool } from '../src/quote.js';
import { PendingNonceManager } from '../src/nonce.js';
import { isEconomicallyExecutable, isQuoteFresh, requiredProfitFloor } from '../src/execution.js';
import { PAIRS, VENUES } from '../src/venues.js';
import { ADDRESSES } from '../src/addresses.js';

describe('Scanner competitiveness upgrade', function () {
  it('registers a third venue and multiple pairs without scanner-specific route code', function () {
    expect(VENUES.map((v) => v.id)).to.include.members(['camelot-v2', 'uniswap-v2', 'sushiswap-v2']);
    expect(PAIRS.map((p) => p.id)).to.include.members(['WETH/USDC', 'WETH/USDT']);
  });

  it('quotes directly from constant-product reserves and charges the configured fee', function () {
    const pool: V2Pool = { pair: '0x0000000000000000000000000000000000000001', tokenIn: ADDRESSES.weth, tokenOut: ADDRESSES.usdc, reserveIn: 1_000_000n, reserveOut: 2_000_000n };
    const quote = quoteFromPool(pool, 30n, 10_000n);
    const amountInWithFee = 10_000n * 9_970n;
    const expected = (amountInWithFee * 2_000_000n) / (1_000_000n * 10_000n + amountInWithFee);
    expect(quote?.amountOut).to.equal(expected);
    expect(quote?.priceImpactBps).to.be.greaterThan(0n);
  });

  it('adaptive sizing expands with liquidity and is capped by the configured impact budget', function () {
    const small = adaptiveCandidateSizes(1_000_000n, 1_000_000n, 1_000n, 2_000n);
    const large = adaptiveCandidateSizes(1_000_000n, 10_000_000n, 1_000n, 2_000n);
    expect(small.at(-1)).to.equal(200_000n);
    expect(large.at(-1)).to.equal(1_000_000n);
    expect(large.at(-1)).to.be.greaterThan(small.at(-1)!);
  });

  it('pins every reserve read to the same block snapshot', async function () {
    const seen: Array<bigint | undefined> = [];
    const fakeClient = { readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      seen.push(blockNumber);
      if (functionName === 'getPair') return '0x0000000000000000000000000000000000000002';
      if (functionName === 'token0') return ADDRESSES.weth;
      return [1_000_000n, 2_000_000n, 1n] as const;
    } } as never;
    const pool = await loadV2Pool(fakeClient, VENUES[0], ADDRESSES.weth, ADDRESSES.usdc, 123n);
    expect(pool?.reserveIn).to.equal(1_000_000n);
    expect(seen).to.deep.equal([123n, 123n, 123n]);
  });

  it('allocates unique sequential nonces under concurrent submission pressure', async function () {
    let reads = 0;
    const manager = new PendingNonceManager(async () => { reads += 1; return 41; });
    const nonces = await Promise.all([manager.reserve(), manager.reserve(), manager.reserve()]);
    expect(nonces).to.have.members([41, 42, 43]);
    expect(reads).to.equal(1);
  });

  it('resetting nonce state forces a fresh pending nonce read after a pre-broadcast failure', async function () {
    let current = 50;
    const manager = new PendingNonceManager(async () => current);
    expect(await manager.reserve()).to.equal(50);
    manager.reset(); current = 52;
    expect(await manager.reserve()).to.equal(52);
  });

  it('rejects stale quotes and accepts a quote only at the same block', function () {
    expect(isQuoteFresh(100n, 100n)).to.equal(true);
    expect(isQuoteFresh(100n, 101n)).to.equal(false);
  });

  it('requires target profit plus the actual gas reserve, and rejects gas spikes above the cap', function () {
    expect(requiredProfitFloor(100n, 20n)).to.equal(120n);
    expect(isEconomicallyExecutable(120n, 100n, 20n, 20n)).to.equal(true);
    expect(isEconomicallyExecutable(119n, 100n, 20n, 20n)).to.equal(false);
    expect(isEconomicallyExecutable(200n, 100n, 21n, 20n)).to.equal(false);
  });
});

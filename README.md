# ArbiFlash-MEV1

A small Arbitrum flash-loan arbitrage prototype using Aave V3 as capital and two V2-style DEX routers for the swap legs.

## What it does

1. Polls Camelot V2 and Uniswap V2-style quotes for WETH/USDC.
2. Looks for a WETH -> USDC -> WETH round trip whose quoted spread exceeds `MIN_PROFIT_WETH`.
3. In the Solidity executor, borrows WETH from Aave V3 with `flashLoanSimple`.
4. Executes both swaps atomically.
5. Repays principal + Aave premium in the same transaction.
6. Reverts unless the executor's pre-existing balance is preserved and the configured minimum profit remains.

The bot starts in **DRY_RUN=true**. It will never send a transaction until you explicitly set `DRY_RUN=false`, provide a deployed executor address, and provide a private key.

## Important

This is an arbitrage engine, not a guaranteed money printer. The scanner uses public RPC quotes, so an opportunity can disappear before inclusion. Gas, price movement, MEV competition, liquidity, router behavior, and Aave's current premium can turn a quoted spread into a loss. Start on a fork/test environment and use a dedicated low-value wallet before considering mainnet execution.

## Arbitrum One addresses

- Aave V3 Pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- Camelot V2 Router: `0xc873fEcbd354f5A56E00E710B90EF4201db2448d`
- Uniswap V2 Router02: `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`
- WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- Native USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`

These addresses were checked against Aave/Camelot/Uniswap deployment documentation while this project was created.

## Local setup

```bash
npm install
cp .env.example .env
npm run build
npm run compile:contract
```

Deploy the executor only after reviewing the contract:

```bash
npx hardhat run scripts/deploy.ts --network arbitrum
```

Then put the printed address into `EXECUTOR_ADDRESS` and keep `DRY_RUN=true` first. The bot will simulate the complete flash-loan call before it can send anything.

For live execution:

```text
DRY_RUN=false
PRIVATE_KEY=<dedicated wallet key>
EXECUTOR_ADDRESS=<deployed executor>
```

Never commit `.env` or a private key.

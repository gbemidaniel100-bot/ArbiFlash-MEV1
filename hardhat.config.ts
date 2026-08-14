import 'dotenv/config';
import { defineConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

export default defineConfig({
  solidity: '0.8.24',
  networks: {
    arbitrum: {
      url: process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc',
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
});

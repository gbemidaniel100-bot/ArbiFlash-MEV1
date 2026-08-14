import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const pool = process.env.AAVE_POOL || '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
  const routerA = process.env.ROUTER_A || '0xc873fEcbd354f5A56E00E710B90EF4201db2448d';
  const routerB = process.env.ROUTER_B || '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';

  const factory = await ethers.getContractFactory('FlashArbExecutor');
  const contract = await factory.deploy(pool, routerA, routerB);
  await contract.waitForDeployment();

  console.log('FlashArbExecutor:', await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

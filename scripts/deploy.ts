import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const pool = process.env.AAVE_POOL || '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
  const routers = [
    process.env.ROUTER_A || '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    process.env.ROUTER_B || '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    process.env.SUSHI_ROUTER || '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  ];

  const factory = await ethers.getContractFactory('FlashArbExecutor');
  const contract = await factory.deploy(pool, routers[0], routers[1]);
  await contract.waitForDeployment();
  await (await contract.setRouter(routers[2], true)).wait();

  console.log('FlashArbExecutor:', await contract.getAddress());
  console.log('Allowed routers:', routers.join(','));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

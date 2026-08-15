import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Adversarial audit - pre-hardening', function () {
  async function deadline() {
    const block = await ethers.provider.getBlock('latest');
    return BigInt(block!.timestamp + 120);
  }

  it('must reject a second flash-loan callback during one active trade', async function () {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const weth = await Token.deploy('Wrapped Ether', 'WETH', 18);
    const usdc = await Token.deploy('USD Coin', 'USDC', 6);
    const Pool = await ethers.getContractFactory('ReentrantPool');
    const pool = await Pool.deploy(ethers.parseEther('0.0009'));
    const Router = await ethers.getContractFactory('MockRouter');
    const routerA = await Router.deploy(weth, usdc, 2, 1);
    const routerB = await Router.deploy(usdc, weth, 3, 5);
    const Executor = await ethers.getContractFactory('FlashArbExecutor');
    const executor = await Executor.deploy(pool, routerA, routerB);
    await weth.mint(pool, ethers.parseEther('20'));
    await pool.setReenter(true);

    // Current code permits the configured pool to invoke executeOperation twice while
    // tradeInProgress is still true. A hardened callback must be single-use.
    await expect(executor.startArbitrage(
      weth, ethers.parseEther('1'), routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, ethers.parseEther('0.1'), await deadline(),
    )).to.be.revertedWithCustomError(executor, 'TradeInProgress');

    expect(owner.address).to.equal(await executor.owner());
  });

  it('must not accept malformed callback data from the configured pool', async function () {
    const Token = await ethers.getContractFactory('MockERC20');
    const weth = await Token.deploy('Wrapped Ether', 'WETH', 18);
    const usdc = await Token.deploy('USD Coin', 'USDC', 6);
    const Pool = await ethers.getContractFactory('PremiumReportingPool');
    const pool = await Pool.deploy(0);
    const Router = await ethers.getContractFactory('MockRouter');
    const routerA = await Router.deploy(weth, usdc, 2, 1);
    const routerB = await Router.deploy(usdc, weth, 3, 5);
    const Executor = await ethers.getContractFactory('FlashArbExecutor');
    const executor = await Executor.deploy(pool, routerA, routerB);
    await weth.mint(pool, ethers.parseEther('10'));

    // This pool is the configured callback sender; malformed params must not be decoded
    // into an unintended execution path.
    const malformed = '0x1234';
    await expect(pool.flashLoanSimple(executor, weth, 1, malformed, 0)).to.be.reverted;
  });

  it('must reject a trade whose exact final balance is one wei below repayment + profit', async function () {
    const Token = await ethers.getContractFactory('MockERC20');
    const weth = await Token.deploy('Wrapped Ether', 'WETH', 18);
    const usdc = await Token.deploy('USD Coin', 'USDC', 6);
    const Pool = await ethers.getContractFactory('MockAavePool');
    const premium = ethers.parseEther('0.0009');
    const pool = await Pool.deploy(weth, premium);
    const Router = await ethers.getContractFactory('MockRouter');
    const routerA = await Router.deploy(weth, usdc, 2, 1);
    const routerB = await Router.deploy(usdc, weth, 1, 2);
    const Executor = await ethers.getContractFactory('FlashArbExecutor');
    const executor = await Executor.deploy(pool, routerA, routerB);
    await weth.mint(pool, ethers.parseEther('10'));

    await expect(executor.startArbitrage(
      weth, ethers.parseEther('1'), routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, 1, await deadline(),
    )).to.be.revertedWithCustomError(executor, 'NotProfitable');
  });
});

import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('FlashArbExecutor', function () {
  async function fixture() {
    const [owner, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const weth = await Token.deploy('Wrapped Ether', 'WETH', 18);
    const usdc = await Token.deploy('USD Coin', 'USDC', 6);
    const Pool = await ethers.getContractFactory('MockAavePool');
    const premium = ethers.parseEther('0.0009');
    const pool = await Pool.deploy(weth, premium);
    const Router = await ethers.getContractFactory('MockRouter');
    const routerA = await Router.deploy(weth, usdc, 2, 1);
    const routerB = await Router.deploy(usdc, weth, 3, 5);
    const Executor = await ethers.getContractFactory('FlashArbExecutor');
    const executor = await Executor.deploy(pool, routerA, routerB);
    await weth.mint(pool, ethers.parseEther('10'));
    return { owner, other, weth, usdc, pool, routerA, routerB, executor, premium };
  }

  async function deadline() {
    const block = await ethers.provider.getBlock('latest');
    return BigInt(block!.timestamp + 120);
  }

  it('executes a profitable atomic flash-loan round trip and leaves profit in executor', async function () {
    const { weth, routerA, routerB, executor, premium } = await fixture();
    const amount = ethers.parseEther('1');
    const minProfit = ethers.parseEther('0.1');
    const dl = await deadline();

    await expect(executor.startArbitrage(
      weth, amount, routerA, [weth, await (await ethers.getContractFactory('MockERC20')).deploy()], 0,
      routerB, [], 0, minProfit, dl,
    )).to.be.reverted;

    const usdc = (await fixture()).usdc;
    // Use the actual fixture tokens/routes for the real execution below.
    const f = await fixture();
    const dl2 = await deadline();
    await expect(f.executor.startArbitrage(
      f.weth, amount, f.routerA, [f.weth, f.usdc], 0,
      f.routerB, [f.usdc, f.weth], 0, minProfit, dl2,
    )).to.emit(f.executor, 'ArbitrageExecuted');

    expect(await f.weth.balanceOf(f.executor)).to.equal(ethers.parseEther('0.1991'));
    expect(await f.weth.balanceOf(f.pool)).to.equal(ethers.parseEther('10.0009'));
    expect(premium).to.equal(ethers.parseEther('0.0009'));
    expect(usdc).to.not.equal(ethers.ZeroAddress);
  });

  it('reverts when the route cannot cover the flash-loan premium and profit floor', async function () {
    const { owner, weth, usdc, pool, routerA, executor, premium } = await fixture();
    const Router = await ethers.getContractFactory('MockRouter');
    const badB = await Router.deploy(usdc, weth, 1, 3);
    await executor.setRouter(badB, true);
    const dl = await deadline();

    await expect(executor.startArbitrage(
      weth, ethers.parseEther('1'), routerA, [weth, usdc], 0,
      badB, [usdc, weth], 0, 1, dl,
    )).to.be.revertedWithCustomError(executor, 'NotProfitable');
    expect(await weth.balanceOf(pool)).to.equal(ethers.parseEther('10'));
    expect(owner.address).to.equal(await executor.owner());
    expect(premium).to.equal(ethers.parseEther('0.0009'));
  });

  it('cannot use existing executor funds to make a losing trade look profitable', async function () {
    const { weth, usdc, routerA, routerB, executor } = await fixture();
    await weth.mint(executor, ethers.parseEther('0.5'));
    await expect(executor.startArbitrage(
      weth, ethers.parseEther('1'), routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, 0, await deadline(),
    )).to.be.revertedWithCustomError(executor, 'NotProfitable');
    expect(await weth.balanceOf(executor)).to.equal(ethers.parseEther('0.5'));
  });

  it('rejects stale opportunities before borrowing', async function () {
    const { weth, usdc, routerA, routerB, executor } = await fixture();
    const block = await ethers.provider.getBlock('latest');
    await expect(executor.startArbitrage(
      weth, 1, routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, 0, BigInt(block!.timestamp - 1),
    )).to.be.revertedWithCustomError(executor, 'DeadlineExpired');
  });

  it('rejects unauthorized callers', async function () {
    const { other, weth, usdc, routerA, routerB, executor } = await fixture();
    await expect(executor.connect(other).startArbitrage(
      weth, 1, routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, 0, await deadline(),
    )).to.be.revertedWithCustomError(executor, 'NotOwner');
  });

  it('rejects disabled routers', async function () {
    const { weth, usdc, routerA, routerB, executor } = await fixture();
    await executor.setRouter(routerB, false);
    await expect(executor.startArbitrage(
      weth, 1, routerA, [weth, usdc], 0,
      routerB, [usdc, weth], 0, 0, await deadline(),
    )).to.be.revertedWithCustomError(executor, 'RouterNotAllowed');
  });

  it('rejects a callback that does not come from the configured pool', async function () {
    const { other, weth, executor } = await fixture();
    const Caller = await ethers.getContractFactory('MockCaller');
    const caller = await Caller.connect(other).deploy();
    await expect(caller.callExecute(executor, weth, 1, 0, '0x')).to.be.revertedWithCustomError(executor, 'NotPool');
  });

  it('rejects invalid route topology', async function () {
    const { weth, usdc, routerA, routerB, executor } = await fixture();
    const other = await (await ethers.getContractFactory('MockERC20')).deploy('Other', 'OTH', 18);
    await expect(executor.startArbitrage(
      weth, 1, routerA, [weth, other], 0,
      routerB, [usdc, weth], 0, 0, await deadline(),
    )).to.be.revertedWithCustomError(executor, 'InvalidPath');
  });
});

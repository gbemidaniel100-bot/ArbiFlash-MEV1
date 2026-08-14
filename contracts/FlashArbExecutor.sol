// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAavePool {
    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external;
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract FlashArbExecutor {
    error NotOwner();
    error NotPool();
    error InvalidInitiator();
    error RouterNotAllowed(address router);
    error InvalidPath();
    error InvalidAmount();
    error InvalidProfitFloor();
    error TradeInProgress();
    error NotProfitable(uint256 finalAmount, uint256 requiredAmount);
    error TokenTransferFailed();
    error TokenApprovalFailed();

    address public immutable owner;
    address public immutable pool;
    mapping(address => bool) public allowedRouter;
    bool private tradeInProgress;

    event RouterPermissionChanged(address indexed router, bool allowed);
    event ArbitrageExecuted(address indexed asset, uint256 borrowed, uint256 premium, uint256 profit);
    event ProfitWithdrawn(address indexed token, uint256 amount, address indexed recipient);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _pool, address _routerA, address _routerB) {
        if (_pool == address(0) || _routerA == address(0) || _routerB == address(0)) revert InvalidPath();
        owner = msg.sender;
        pool = _pool;
        allowedRouter[_routerA] = true;
        allowedRouter[_routerB] = true;
        emit RouterPermissionChanged(_routerA, true);
        emit RouterPermissionChanged(_routerB, true);
    }

    function setRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert InvalidPath();
        allowedRouter[router] = allowed;
        emit RouterPermissionChanged(router, allowed);
    }

    function startArbitrage(
        address asset,
        uint256 amount,
        address routerA,
        address[] calldata pathA,
        uint256 minOutA,
        address routerB,
        address[] calldata pathB,
        uint256 minOutB,
        uint256 minProfit
    ) external onlyOwner {
        if (asset == address(0) || amount == 0) revert InvalidAmount();
        if (minProfit == type(uint256).max) revert InvalidProfitFloor();
        if (tradeInProgress) revert TradeInProgress();
        _validateTrade(asset, routerA, pathA, routerB, pathB);

        tradeInProgress = true;
        IAavePool(pool).flashLoanSimple(
            address(this),
            asset,
            amount,
            abi.encode(routerA, pathA, minOutA, routerB, pathB, minOutB, minProfit),
            0
        );
        tradeInProgress = false;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != pool) revert NotPool();
        if (initiator != address(this) || !tradeInProgress) revert InvalidInitiator();

        (
            address routerA,
            address[] memory pathA,
            uint256 minOutA,
            address routerB,
            address[] memory pathB,
            uint256 minOutB,
            uint256 minProfit
        ) = abi.decode(params, (address, address[], uint256, address, address[], uint256, uint256));

        _validateTrade(asset, routerA, pathA, routerB, pathB);

        // Existing balances must never subsidize a losing flash-loan trade.
        uint256 preLoanBalance = IERC20(asset).balanceOf(address(this));
        address intermediate = pathA[pathA.length - 1];

        _forceApprove(asset, routerA, amount);
        uint256 beforeIntermediate = IERC20(intermediate).balanceOf(address(this));
        IUniswapV2Router(routerA).swapExactTokensForTokens(
            amount,
            minOutA,
            pathA,
            address(this),
            block.timestamp
        );
        uint256 intermediateReceived = IERC20(intermediate).balanceOf(address(this)) - beforeIntermediate;
        if (intermediateReceived == 0) revert InvalidAmount();

        _forceApprove(intermediate, routerB, intermediateReceived);
        IUniswapV2Router(routerB).swapExactTokensForTokens(
            intermediateReceived,
            minOutB,
            pathB,
            address(this),
            block.timestamp
        );

        uint256 required = preLoanBalance + amount + premium;
        uint256 finalAmount = IERC20(asset).balanceOf(address(this));
        if (finalAmount < required || finalAmount - required < minProfit) {
            revert NotProfitable(finalAmount, required + minProfit);
        }

        _forceApprove(asset, pool, amount + premium);
        uint256 profit = finalAmount - required;
        emit ArbitrageExecuted(asset, amount, premium, profit);
        return true;
    }

    function withdraw(address token, uint256 amount, address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidPath();
        if (!IERC20(token).transfer(recipient, amount)) revert TokenTransferFailed();
        emit ProfitWithdrawn(token, amount, recipient);
    }

    function withdrawETH(address payable recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidPath();
        (bool ok,) = recipient.call{value: address(this).balance}("");
        if (!ok) revert TokenTransferFailed();
    }

    function _validateTrade(
        address asset,
        address routerA,
        address[] memory pathA,
        address routerB,
        address[] memory pathB
    ) internal view {
        if (!allowedRouter[routerA]) revert RouterNotAllowed(routerA);
        if (!allowedRouter[routerB]) revert RouterNotAllowed(routerB);
        if (pathA.length < 2 || pathB.length < 2) revert InvalidPath();
        if (pathA[0] != asset || pathB[pathB.length - 1] != asset) revert InvalidPath();
        if (pathA[pathA.length - 1] != pathB[0]) revert InvalidPath();
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        // Reset-first is compatible with tokens that reject changing a non-zero allowance directly.
        if (!IERC20(token).approve(spender, 0)) revert TokenApprovalFailed();
        if (!IERC20(token).approve(spender, amount)) revert TokenApprovalFailed();
    }

    receive() external payable {}
}

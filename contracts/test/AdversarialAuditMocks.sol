// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlashReceiverAudit {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool);
}

interface IERC20Audit {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Test-only pool that attempts a second callback while the first callback is active.
contract ReentrantPool {
    uint256 public premium;
    bool public reenter;
    bool private entered;

    constructor(uint256 _premium) { premium = _premium; }

    function setReenter(bool value) external { reenter = value; }

    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        IERC20Audit(asset).transfer(receiver, amount);
        entered = false;
        require(IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params), 'callback');
    }

    function attemptReenter(address receiver, address asset, uint256 amount, bytes calldata params) external returns (bool) {
        if (reenter && !entered) {
            entered = true;
            return IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params);
        }
        return true;
    }
}

/// @dev Test-only router that asks the configured pool to re-enter the executor callback.
contract ReentrantRouter {
    ReentrantPool public immutable pool;
    address public immutable inputToken;
    address public immutable outputToken;
    uint256 public immutable numerator;
    uint256 public immutable denominator;

    constructor(ReentrantPool _pool, address _input, address _output, uint256 _n, uint256 _d) {
        pool = _pool; inputToken = _input; outputToken = _output; numerator = _n; denominator = _d;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, 'expired');
        require(path.length == 2 && path[0] == inputToken && path[1] == outputToken, 'path');
        require(amountIn > 0, 'amount');
        uint256 amountOut = amountIn * numerator / denominator;
        require(amountOut >= amountOutMin, 'slippage');
        pool.attemptReenter(to, inputToken, amountIn, abi.encode(address(0), new address[](0), uint256(0), address(0), new address[](0), uint256(0), uint256(0), deadline, uint256(0)));
        amounts = new uint256[](2); amounts[0] = amountIn; amounts[1] = amountOut;
    }
}

/// @dev Test-only pool that supplies a premium inconsistent with the configured economic expectation.
contract PremiumReportingPool {
    uint256 public premium;
    constructor(uint256 _premium) { premium = _premium; }
    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        IERC20Audit(asset).transfer(receiver, amount);
        require(IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params), 'callback');
    }
}

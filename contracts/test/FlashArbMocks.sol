// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlashReceiver {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool);
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d) { name = n; symbol = s; decimals = d; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { require(balanceOf[msg.sender] >= amount, 'balance'); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, 'allowance'); allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}

contract MockAavePool {
    MockERC20 public immutable asset;
    uint256 public premium;
    constructor(MockERC20 _asset, uint256 _premium) { asset = _asset; premium = _premium; }
    function flashLoanSimple(address receiver, address loanAsset, uint256 amount, bytes calldata params, uint16) external {
        require(loanAsset == address(asset), 'asset');
        asset.transfer(receiver, amount);
        require(IFlashReceiver(receiver).executeOperation(loanAsset, amount, premium, receiver, params), 'callback');
        require(asset.transferFrom(receiver, address(this), amount + premium), 'repay');
    }
}

contract MockRouter {
    MockERC20 public immutable inputToken;
    MockERC20 public immutable outputToken;
    uint256 public immutable numerator;
    uint256 public immutable denominator;
    constructor(MockERC20 input, MockERC20 output, uint256 n, uint256 d) { inputToken = input; outputToken = output; numerator = n; denominator = d; }
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, 'expired');
        require(path.length >= 2 && path[0] == address(inputToken) && path[path.length - 1] == address(outputToken), 'path');
        uint256 amountOut = amountIn * numerator / denominator;
        require(amountOut >= amountOutMin, 'slippage');
        require(inputToken.transferFrom(msg.sender, address(this), amountIn), 'in');
        outputToken.mint(to, amountOut);
        amounts = new uint256[](2); amounts[0] = amountIn; amounts[1] = amountOut;
    }
}

contract MockCaller {
    function callExecute(address executor, address asset, uint256 amount, uint256 premium, bytes calldata params) external returns (bool) {
        return IFlashReceiver(executor).executeOperation(asset, amount, premium, address(this), params);
    }
}

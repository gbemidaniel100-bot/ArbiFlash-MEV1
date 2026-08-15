// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlashReceiverAudit {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool);
}

interface IERC20Audit {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Test-only pool that deliberately calls the receiver twice in one flash-loan transaction.
contract ReentrantPool {
    uint256 public premium;
    bool public reenter;
    uint256 public callbackCount;

    constructor(uint256 _premium) { premium = _premium; }
    function setReenter(bool value) external { reenter = value; }

    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        IERC20Audit(asset).transfer(receiver, amount);
        callbackCount = 0;
        require(IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params), 'callback-1');
        if (reenter) {
            callbackCount = 1;
            // Give the receiver another unit of capital so the second callback can complete.
            IERC20Audit(asset).transfer(receiver, amount);
            require(IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params), 'callback-2');
        }
    }
}

/// @dev Test-only pool with a configurable reported premium.
contract PremiumReportingPool {
    uint256 public premium;
    constructor(uint256 _premium) { premium = _premium; }
    function setPremium(uint256 value) external { premium = value; }
    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        IERC20Audit(asset).transfer(receiver, amount);
        require(IFlashReceiverAudit(receiver).executeOperation(asset, amount, premium, receiver, params), 'callback');
    }
}

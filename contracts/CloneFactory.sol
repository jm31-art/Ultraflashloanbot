// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CloneFactory {
    function createClone(address target) internal returns (address result) {
        // Convert address to bytes20 for assembly
        bytes20 targetBytes = bytes20(target);
        
        assembly {
            // Load free memory pointer
            let clone := mload(0x40)
            // Store minimal proxy bytecode
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            // Create new contract
            result := create(0, clone, 0x37)
        }
        require(result != address(0), "Create failed");
    }
}

contract ArbitrageDeployer is CloneFactory {
    address public implementation;
    mapping(address => bool) public isClone;
    
    constructor(address _implementation) {
        implementation = _implementation;
    }
    
    function deployClone(
        uint256 minProfit,
        uint256 gasRefundCap
    ) external returns (address clone) {
        clone = createClone(implementation);
        isClone[clone] = true;
        
        // Initialize the clone
        (bool success,) = clone.call(
            abi.encodeWithSignature(
                "initialize(address,uint256,uint256)",
                msg.sender,
                minProfit,
                gasRefundCap
            )
        );
        require(success, "Initialization failed");
    }
}

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

describe("FlashloanArb Gas Optimization Tests", function () {
    let flashloanArb;
    let owner;
    let addr1;
    
    const TOKENS = {
        WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        USDT: "0x55d398326f99059fF775485246999027B3197955",
        BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"
    };

    beforeEach(async function () {
        [owner, addr1] = await ethers.getSigners();
        
        const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
        flashloanArb = await FlashloanArb.deploy();
        await flashloanArb.deployed();
    });

    it("Should optimize gas usage for contract setup", async function () {
        // Test gas usage for contract setup operations
        const path = [TOKENS.WBNB, TOKENS.USDT];
        const exchanges = ["PancakeSwap"];
        const amount = ethers.utils.parseEther("1");

        // Measure gas for multiple setup operations
        const setupTx = await flashloanArb.setDODOPool(
            TOKENS.WBNB,
            "0xBe60d4c4250438344bEC816Ec2deC99925dEb4c7"
        );
        const receipt = await setupTx.wait();
        
        console.log("Gas used for pool setup:", receipt.gasUsed.toString());
        expect(receipt.gasUsed).to.be.below(100000); // Target: Less than 100k gas for setup

        // Test router setup gas usage
        const routerSetupTx = await flashloanArb.setRouter(
            "TestRouter",
            "0x10ED43C718714eb63d5aA57B78B54704E256024E"
        );
        const routerReceipt = await routerSetupTx.wait();
        
        console.log("Gas used for router setup:", routerReceipt.gasUsed.toString());
        expect(routerReceipt.gasUsed).to.be.below(50000); // Target: Less than 50k gas for router setup
    });

    it("Should batch multiple operations for gas efficiency", async function () {
        // Test data for multiple operations
        const operations = [
            {
                path: [TOKENS.WBNB, TOKENS.USDT],
                exchanges: ["PancakeSwap"],
                amount: ethers.utils.parseEther("0.5")
            },
            {
                path: [TOKENS.BUSD, TOKENS.USDT],
                exchanges: ["BiSwap"],
                amount: ethers.utils.parseEther("1000")
            }
        ];

        // Set up DODO pools
        const poolSetupTx = await Promise.all([
            flashloanArb.setDODOPool(TOKENS.WBNB, "0xBe60d4c4250438344bEC816Ec2deC99925dEb4c7"),
            flashloanArb.setDODOPool(TOKENS.BUSD, "0x5BDCf4962FDED6B7156E710400F4C4c031f600dC")
        ]);

        let totalGas = BigNumber.from(0);
        for (const receipt of await Promise.all(poolSetupTx.map(tx => tx.wait()))) {
            totalGas = totalGas.add(receipt.gasUsed);
        }

        console.log("Gas used for batch pool setup:", totalGas.toString());
        expect(totalGas).to.be.below(300000); // Target: Less than 300k gas for setup
    });

    it("Should optimize withdrawal operations", async function () {
        // Test auto-withdrawal efficiency
        const withdrawTx = await flashloanArb.autoWithdrawProfits();
        const receipt = await withdrawTx.wait();

        console.log("Gas used for auto-withdrawal:", receipt.gasUsed.toString());
        expect(receipt.gasUsed).to.be.below(200000); // Target: Less than 200k gas
    });
});

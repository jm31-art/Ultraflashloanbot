const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("FlashloanArb", function () {
  async function deployFlashloanFixture() {
    const [owner, otherAccount] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    const tokenA = await MockToken.deploy("TokenA", "TA");
    const tokenB = await MockToken.deploy("TokenB", "TB");
    await tokenA.deployed();
    await tokenB.deployed();

    // Deploy mock DEXes
    const MockDex = await ethers.getContractFactory("MockDex");
    const dexA = await MockDex.deploy();
    const dexB = await MockDex.deploy();
    await dexA.deployed();
    await dexB.deployed();

    // Setup initial liquidity
    const INITIAL_LIQUIDITY = ethers.utils.parseEther("1000");
    await tokenA.mint(dexA.address, INITIAL_LIQUIDITY);
    await tokenB.mint(dexA.address, INITIAL_LIQUIDITY);
    await tokenA.mint(dexB.address, INITIAL_LIQUIDITY);
    await tokenB.mint(dexB.address, INITIAL_LIQUIDITY);

    // Deploy FlashloanArb contract
    const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
    const flashloanArb = await FlashloanArb.deploy();
    await flashloanArb.deployed();

    return { 
      flashloanArb, 
      tokenA, 
      tokenB, 
      dexA, 
      dexB, 
      owner, 
      otherAccount,
      INITIAL_LIQUIDITY
    };
  }

  describe("Arbitrage", function () {
    it("Should execute profitable arbitrage", async function () {
      const { flashloanArb, tokenA, tokenB, dexA, dexB, owner } = await loadFixture(deployFlashloanFixture);

      // Set different prices on DEXes to create arbitrage opportunity
      await dexA.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("1.1")); // 1 A = 1.1 B
      await dexB.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("0.9")); // 1 A = 0.9 B

      // Calculate expected profit
      const flashloanAmount = ethers.utils.parseEther("100");
      const expectedProfit = ethers.utils.parseEther("0.2").mul(100); // 0.2 token difference * 100 tokens

      // Execute arbitrage
      const tx = await flashloanArb.executeArbitrage(
        tokenA.address,
        tokenB.address,
        flashloanAmount,
        dexA.address,
        dexB.address
      );

      // Verify profit
      const profit = await tokenB.balanceOf(owner.address);
      expect(profit).to.be.gte(expectedProfit);
    });

    it("Should revert if no profitable arbitrage opportunity exists", async function () {
      const { flashloanArb, tokenA, tokenB, dexA, dexB } = await loadFixture(deployFlashloanFixture);

      // Set equal prices on both DEXes
      await dexA.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("1"));
      await dexB.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("1"));

      const flashloanAmount = ethers.utils.parseEther("100");

      // Execute arbitrage should revert
      await expect(
        flashloanArb.executeArbitrage(
          tokenA.address,
          tokenB.address,
          flashloanAmount,
          dexA.address,
          dexB.address
        )
      ).to.be.revertedWith("No profitable arbitrage opportunity");
    });

    it("Should handle gas costs in profit calculation", async function () {
      const { flashloanArb, tokenA, tokenB, dexA, dexB } = await loadFixture(deployFlashloanFixture);

      // Set prices with small spread
      await dexA.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("1.01"));
      await dexB.setPrice(tokenA.address, tokenB.address, ethers.utils.parseEther("0.99"));

      const flashloanAmount = ethers.utils.parseEther("100");

      // Execute arbitrage should revert due to insufficient profit after gas
      await expect(
        flashloanArb.executeArbitrage(
          tokenA.address,
          tokenB.address,
          flashloanAmount,
          dexA.address,
          dexB.address
        )
      ).to.be.revertedWith("Insufficient profit after gas costs");
    });
  });
});

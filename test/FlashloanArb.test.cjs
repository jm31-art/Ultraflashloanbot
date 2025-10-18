const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashloanArb", function() {
  let flashloanArb;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function() {
    [owner, addr1, addr2] = await ethers.getSigners();

    const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
    flashloanArb = await FlashloanArb.deploy();
    await flashloanArb.deployed();
  });

  describe("Deployment", function() {
    it("Should set the right owner", async function() {
      expect(await flashloanArb.owner()).to.equal(owner.address);
    });

    it("Should set initial parameters correctly", async function() {
      expect(await flashloanArb.minProfit()).to.equal(0);
      expect(await flashloanArb.safetyChecksEnabled()).to.be.true;
    });
  });

  describe("Router Management", function() {
    it("Should allow owner to set router", async function() {
      await flashloanArb.setRouter("TestSwap", addr1.address);
      expect(await flashloanArb.routers("TestSwap")).to.equal(addr1.address);
    });

    it("Should prevent non-owner from setting router", async function() {
      await expect(
        flashloanArb.connect(addr1).setRouter("TestSwap", addr2.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Safety Controls", function() {
    it("Should allow owner to toggle safety checks", async function() {
      await flashloanArb.toggleSafetyChecks();
      expect(await flashloanArb.safetyChecksEnabled()).to.be.false;

      await flashloanArb.toggleSafetyChecks();
      expect(await flashloanArb.safetyChecksEnabled()).to.be.true;
    });

    it("Should prevent non-owner from toggling safety checks", async function() {
      await expect(
        flashloanArb.connect(addr1).toggleSafetyChecks()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Profit Management", function() {
    it("Should allow owner to set minimum profit", async function() {
      const profit = ethers.utils.parseEther("1.0");
      await flashloanArb.setMinProfit(profit);
      expect(await flashloanArb.minProfit()).to.equal(profit);
    });

    it("Should prevent non-owner from setting minimum profit", async function() {
      await expect(
        flashloanArb.connect(addr1).setMinProfit(ethers.utils.parseEther("1.0"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Pause Functionality", function() {
    it("Should allow owner to pause and unpause", async function() {
      await flashloanArb.pause();
      expect(await flashloanArb.paused()).to.be.true;

      await flashloanArb.unpause();
      expect(await flashloanArb.paused()).to.be.false;
    });

    it("Should prevent non-owner from pausing", async function() {
      await expect(
        flashloanArb.connect(addr1).pause()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});

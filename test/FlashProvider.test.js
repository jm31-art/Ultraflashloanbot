const { expect } = require("chai");
const { ethers } = require("hardhat");
const FlashProvider = require("../utils/FlashProvider");

describe("FlashProvider", function() {
    let flashProvider;

    before(async function() {
        const [signer] = await ethers.getSigners();
        flashProvider = new FlashProvider(signer.provider);
    });

    describe("Fee Estimation", function() {
        it("should estimate flash loan fees correctly", async function() {
            const amount = ethers.utils.parseEther("100");
            const uniswapFee = await flashProvider.estimateFlashCost(amount, 'UniswapV3');
            const pancakeFee = await flashProvider.estimateFlashCost(amount, 'PancakeV3');
            const balancerFee = await flashProvider.estimateFlashCost(amount, 'Balancer');

            expect(uniswapFee).to.equal(amount * 0.0005); // 0.05%
            expect(pancakeFee).to.equal(amount * 0.0002); // 0.02%
            expect(balancerFee).to.equal(0); // 0%
        });
    });

    describe("Best Provider Selection", function() {
        it("should find the cheapest flash provider", async function() {
            const amount = ethers.utils.parseEther("100");
            const bestProvider = await flashProvider.findBestFlashProvider("WETH", amount);

            // Balancer should be chosen as it has 0% fee
            expect(bestProvider.protocol).to.equal('Balancer');
            expect(bestProvider.fee).to.equal(0);
            expect(bestProvider.type).to.equal('flashLoan');
        });
    });

    describe("Liquidity Checking", function() {
        it("should check flash swap liquidity", async function() {
            const result = await flashProvider.checkFlashSwapLiquidity("WETH", "UniswapV3");
            expect(result.hasLiquidity).to.be.true;
            expect(result.fee).to.equal(0.0005);
        });
    });

    describe("Fee Calculation", function() {
        it("should calculate correct fees for each protocol", function() {
            const amount = 100;
            
            const protocols = ['UniswapV3', 'PancakeV3', 'Balancer', 'DODO', 'Curve'];
            const expectedFees = [0.05, 0.02, 0, 0.3, 0.04];

            protocols.forEach((protocol, i) => {
                const fee = flashProvider.getFlashFee(protocol, amount);
                expect(fee).to.equal(amount * (expectedFees[i] / 100));
            });
        });
    });
});

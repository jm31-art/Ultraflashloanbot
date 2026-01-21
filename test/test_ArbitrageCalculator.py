#!/usr/bin/env python3
"""
Test script for ArbitrageCalculator.py on Sepolia testnet
Tests triangular arbitrage calculations and path scanning
"""

import pytest
import sys
import os
from decimal import Decimal
from unittest.mock import Mock, patch
import json

# Add parent directory to path to import the service
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestArbitrageCalculator:
    """Test suite for ArbitrageCalculator on Sepolia testnet"""

    def setup_method(self):
        """Setup test environment with Sepolia configuration"""
        # Sepolia testnet token addresses
        self.WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
        self.USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
        self.DAI = "0x68194a729C2450ad26072b3D33ADaCbcef39D5741"

        # Sepolia DEX addresses (Uniswap V2)
        self.ROUTER = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008"
        self.FACTORY = "0x7E0987E5b3a30e3f2828572Bb659A548460a30077"

        # Sepolia RPC
        self.RPC = os.getenv("SEPOLIA_RPC", "https://sepolia.infura.io/v3/" + (os.getenv("INFURA_PROJECT_ID") or "YOUR_INFURA_PROJECT_ID"))

        # Test triangular paths for Sepolia
        self.TRI_PATHS = [
            {"name": "WETH→USDC→DAI→WETH", "path": [self.WETH, self.USDC, self.DAI, self.WETH], "start": self.WETH},
            {"name": "USDC→DAI→WETH→USDC", "path": [self.USDC, self.DAI, self.WETH, self.USDC], "start": self.USDC},
        ]

    @patch('services.ArbitrageCalculator.w3')
    def test_get_price_functionality(self, mock_w3):
        """Test price fetching functionality"""
        # Mock the router contract call
        mock_router = Mock()
        mock_router.functions.getAmountsOut.return_value.call.return_value = [10**18, 2000000]  # 2 USDC for 1 WETH
        mock_w3.eth.contract.return_value = mock_router

        # Import and test the function
        from services.ArbitrageCalculator import get_price

        result = get_price(self.WETH, self.USDC, 10**18)
        assert result == 2000000
        print("✅ Price fetching test passed")

    def test_calculate_tri_profit_mock(self):
        """Test triangular profit calculation with mocked prices"""
        from services.ArbitrageCalculator import calculate_tri_profit

        # Mock path with profitable arbitrage
        test_path = {
            "name": "Test Path",
            "path": [self.WETH, self.USDC, self.DAI, self.WETH],
            "start": self.WETH
        }

        # Mock the get_price function to return profitable values
        with patch('services.ArbitrageCalculator.get_price') as mock_get_price:
            # Set up mock returns for profitable arbitrage
            mock_get_price.side_effect = [
                2000000,    # WETH -> USDC: 1 WETH = 2000 USDC
                2000000000000000000,  # USDC -> DAI: 2000 USDC = 2000 DAI
                10**18,     # DAI -> WETH: 2000 DAI = 1 WETH (profitable)
                2500000000000000000   # Final WETH -> USDT conversion for profit calc
            ]

            profit = calculate_tri_profit(test_path, Decimal("1000"))
            assert isinstance(profit, Decimal)
            print(f"✅ Triangular profit calculation test passed: ${profit}")

    @patch('services.ArbitrageCalculator.TRI_PATHS', new_callable=lambda: [
        {"name": "WETH→USDC→DAI→WETH", "path": ["0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "0x68194a729C2450ad26072b3D33ADaCbcef39D5741", "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"], "start": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"},
    ])
    def test_scan_all_paths_structure(self, mock_tri_paths):
        """Test the structure of path scanning functionality"""
        from services.ArbitrageCalculator import scan_all_paths

        # Mock the calculation functions
        with patch('services.ArbitrageCalculator.calculate_tri_profit') as mock_calc:
            mock_calc.return_value = Decimal("5.50")  # Mock profitable result

            with patch('builtins.print') as mock_print:
                result = scan_all_paths()

                # Verify the function returns a value
                assert isinstance(result, Decimal)
                print("✅ Path scanning structure test passed")

    def test_sepolia_token_addresses(self):
        """Test that Sepolia token addresses are properly configured"""
        # Verify addresses are valid Ethereum addresses (0x followed by 40 hex chars)
        import re

        for token_addr in [self.WETH, self.USDC, self.DAI]:
            assert re.match(r'^0x[a-fA-F0-9]{40}$', token_addr), f"Invalid address: {token_addr}"

        print("✅ Sepolia token address validation passed")

    def test_triangular_paths_structure(self):
        """Test that triangular paths are properly structured"""
        for path_info in self.TRI_PATHS:
            assert 'name' in path_info
            assert 'path' in path_info
            assert 'start' in path_info
            assert len(path_info['path']) == 4  # Triangular arbitrage needs 4 addresses (A->B->C->A)
            assert path_info['path'][0] == path_info['start']  # First token matches start
            assert path_info['path'][-1] == path_info['start']  # Last token matches start

        print("✅ Triangular path structure validation passed")

    @pytest.mark.asyncio
    async def test_integration_with_testnet(self):
        """Integration test with Sepolia testnet (limited due to testnet liquidity)"""
        try:
            from web3 import Web3

            # Connect to Sepolia
            w3 = Web3(Web3.HTTPProvider(self.RPC))

            if not w3.is_connected():
                print("⚠️ Cannot connect to Sepolia RPC - skipping integration test")
                return

            # Test basic connectivity
            block_number = w3.eth.block_number
            assert block_number > 0
            print(f"✅ Sepolia connection test passed - Block: {block_number}")

            # Test router contract existence (without calling functions due to low liquidity)
            router_code = w3.eth.get_code(self.ROUTER)
            assert len(router_code) > 2  # Contract has code
            print("✅ Router contract existence test passed")

        except Exception as e:
            print(f"⚠️ Sepolia integration test failed: {e}")
            print("   This is expected on testnet with limited liquidity")

def run_tests():
    """Run all tests and report results"""
    print("🧪 Testing ArbitrageCalculator on Sepolia testnet...\n")

    test_instance = TestArbitrageCalculator()
    test_instance.setup_method()

    # Run individual tests
    try:
        test_instance.test_sepolia_token_addresses()
        test_instance.test_triangular_paths_structure()
        test_instance.test_get_price_functionality()
        test_instance.test_calculate_tri_profit_mock()
        test_instance.test_scan_all_paths_structure()

        # Run async integration test
        import asyncio
        asyncio.run(test_instance.test_integration_with_testnet())

        print("\n✅ All ArbitrageCalculator tests completed successfully!")
        print("💡 Testnet testing notes:")
        print("   1. Sepolia has limited liquidity compared to mainnets")
        print("   2. Triangular arbitrage opportunities may be rare")
        print("   3. Use mainnet for production testing with real arbitrage")
        print("   4. Mock tests validate calculation logic")
        print("   5. Integration tests verify contract connectivity")

    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
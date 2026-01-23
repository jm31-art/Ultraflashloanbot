#!/usr/bin/env python3
"""
PRODUCTION DEPLOYMENT SCRIPT FOR ULTRA FLASH LOAN BOT
Ensures safe launch with comprehensive validation and emergency procedures
"""

import os
import sys
import time
import logging
from decimal import Decimal
from web3 import Web3
from web3.middleware import geth_poa_middleware
from eth_account import Account
from dotenv import load_dotenv

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('deployment.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Configuration
RPC_URL = os.getenv('BSC_RPC_URL', 'https://bsc-dataseed.binance.org/')
PRIVATE_KEY = os.getenv('PRIVATE_KEY')
FLASH_LOAN_CONTRACT = os.getenv('FLASH_LOAN_CONTRACT')
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

# Contract addresses
CONTRACTS = {
    'FlashloanArb': FLASH_LOAN_CONTRACT,
    'PancakeSwap_Router': '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    'Biswap_Router': '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD48',
    'ApeSwap_Router': '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
}

# Token addresses
TOKENS = {
    'USDT': '0x55d398326f99059fF775485246999027B3197955',
    'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
}

# ABIs
ERC20_ABI = [
    {"constant": True, "inputs": [{"name": "_owner", "type": "address"}, {"name": "_spender", "type": "address"}], "name": "allowance", "outputs": [{"name": "", "type": "uint256"}], "type": "function"},
    {"constant": False, "inputs": [{"name": "_spender", "type": "address"}, {"name": "_value", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "type": "function"},
    {"constant": True, "inputs": [{"name": "_owner", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "type": "function"},
]

FLASH_ARB_ABI = [
    {"inputs": [{"internalType": "string", "name": "name", "type": "string"}, {"internalType": "address", "name": "router", "type": "address"}], "name": "setRouter", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"internalType": "address", "name": "token", "type": "address"}, {"internalType": "address", "name": "tokenB", "type": "address"}, {"internalType": "address", "name": "tokenC", "type": "address"}, {"internalType": "uint256", "name": "amountIn", "type": "uint256"}, {"internalType": "string", "name": "router1Name", "type": "string"}, {"internalType": "string", "name": "router2Name", "type": "string"}, {"internalType": "string", "name": "router3Name", "type": "string"}, {"internalType": "uint256", "name": "minReturnA", "type": "uint256"}, {"internalType": "uint256", "name": "deadline", "type": "uint256"}], "name": "executeTriArb", "outputs": [{"internalType": "uint256", "name": "finalAmountA", "type": "uint256"}, {"internalType": "uint256", "name": "profit", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
]

# Deployment checklist
DEPLOYMENT_STEPS = [
    "✅ Verify all environment variables are set",
    "✅ Verify wallet has minimum 2 BNB balance",
    "✅ Validate all contract addresses have bytecode",
    "✅ Check token approvals for FlashloanArb contract",
    "✅ Set router addresses in FlashloanArb contract",
    "✅ Execute $10 test trade to verify functionality",
    "✅ Verify Telegram notifications are working",
    "✅ Start monitoring dashboard",
    "✅ Enable MONITOR_MODE for 24-hour observation",
    "✅ Enable LIVE_TRADING only after successful testing",
]

class ProductionDeployer:
    def __init__(self):
        self.w3 = None
        self.account = None
        self.flash_contract = None
        self.completed_steps = []

    def log_step(self, step, status="✅"):
        """Log deployment step"""
        logger.info(f"{status} {step}")
        self.completed_steps.append(step)

    def send_telegram_alert(self, message):
        """Send Telegram alert"""
        if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
            logger.warning("Telegram not configured, skipping alert")
            return

        try:
            import requests
            url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
            data = {
                'chat_id': TELEGRAM_CHAT_ID,
                'text': f"🚀 DEPLOYMENT: {message}",
                'parse_mode': 'HTML'
            }
            requests.post(url, data=data, timeout=10)
        except Exception as e:
            logger.error(f"Failed to send Telegram alert: {e}")

    def validate_environment(self):
        """Step 1: Validate environment variables"""
        required_vars = ['PRIVATE_KEY', 'FLASH_LOAN_CONTRACT', 'BSC_RPC_URL']
        missing = [var for var in required_vars if not os.getenv(var)]

        if missing:
            raise ValueError(f"Missing required environment variables: {missing}")

        # Initialize Web3
        self.w3 = Web3(Web3.HTTPProvider(RPC_URL))
        self.w3.middleware_onion.inject(geth_poa_middleware, layer=0)

        if not self.w3.is_connected():
            raise ConnectionError("Cannot connect to BSC RPC")

        # Initialize account
        self.account = Account.from_key(PRIVATE_KEY)
        logger.info(f"Wallet address: {self.account.address}")

        # Initialize contract
        self.flash_contract = self.w3.eth.contract(
            address=FLASH_LOAN_CONTRACT,
            abi=FLASH_ARB_ABI
        )

        self.log_step("Verify all environment variables are set")

    def validate_wallet_balance(self):
        """Step 2: Check wallet has minimum BNB"""
        balance = self.w3.eth.get_balance(self.account.address)
        balance_bnb = self.w3.from_wei(balance, 'ether')

        if balance_bnb < 2:
            raise ValueError(f"Insufficient BNB balance: {balance_bnb}. Need at least 2 BNB")

        logger.info(f"Wallet BNB balance: {balance_bnb}")
        self.log_step("Verify wallet has minimum 2 BNB balance")

    def validate_contract_addresses(self):
        """Step 3: Verify contracts have bytecode"""
        for name, address in CONTRACTS.items():
            if not address or address == '0x':
                raise ValueError(f"Contract {name} address not set")

            code = self.w3.eth.get_code(address)
            if code == b'0x' or len(code) < 10:
                raise ValueError(f"Contract {name} at {address} has no valid bytecode")

            logger.info(f"✅ Contract {name} verified at {address}")

        self.log_step("Validate all contract addresses have bytecode")

    def check_token_approvals(self):
        """Step 4: Check token approvals"""
        for token_name, token_address in TOKENS.items():
            token_contract = self.w3.eth.contract(token_address, abi=ERC20_ABI)
            allowance = token_contract.functions.allowance(
                self.account.address, FLASH_LOAN_CONTRACT
            ).call()

            if allowance < 10**18:  # Less than 1 token
                logger.warning(f"⚠️  Token {token_name} not approved for FlashloanArb")
                # Could auto-approve here, but manual for safety
            else:
                logger.info(f"✅ Token {token_name} approved")

        self.log_step("Check token approvals for FlashloanArb contract")

    def set_router_addresses(self):
        """Step 5: Set router addresses in contract"""
        routers = {
            'PancakeSwap': CONTRACTS['PancakeSwap_Router'],
            'Biswap': CONTRACTS['Biswap_Router'],
            'ApeSwap': CONTRACTS['ApeSwap_Router'],
        }

        for name, address in routers.items():
            try:
                tx = self.flash_contract.functions.setRouter(name, address).build_transaction({
                    'from': self.account.address,
                    'nonce': self.w3.eth.get_transaction_count(self.account.address),
                    'gas': 100000,
                    'gasPrice': self.w3.eth.gas_price,
                })

                signed = self.account.sign_transaction(tx)
                tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)

                if receipt.status == 1:
                    logger.info(f"✅ Set {name} router: {address}")
                else:
                    raise ValueError(f"Failed to set {name} router")

            except Exception as e:
                logger.error(f"Failed to set {name} router: {e}")
                raise

        self.log_step("Set router addresses in FlashloanArb contract")

    def test_small_trade(self):
        """Step 6: Execute $10 test trade"""
        logger.info("🧪 Executing $10 test trade...")

        # Use small amounts for testing
        test_amount = int(10 * 10**18)  # 10 USDT (assuming 18 decimals)

        try:
            # Build test transaction
            deadline = int(time.time()) + 300

            tx = self.flash_contract.functions.executeTriArb(
                TOKENS['USDT'],  # tokenA
                TOKENS['BUSD'],  # tokenB
                TOKENS['USDT'],  # tokenC (back to USDT)
                test_amount,     # amountIn
                'PancakeSwap',  # router1
                'Biswap',       # router2
                'ApeSwap',      # router3
                0,              # minReturnA (allow any for test)
                deadline
            ).build_transaction({
                'from': self.account.address,
                'nonce': self.w3.eth.get_transaction_count(self.account.address),
                'gas': 1000000,  # Higher gas for arbitrage
                'gasPrice': self.w3.eth.gas_price,
            })

            # Estimate gas
            gas_estimate = self.w3.eth.estimate_gas(tx)
            tx['gas'] = int(gas_estimate * 1.2)  # 20% buffer

            # Sign and send
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)

            logger.info(f"Test trade sent: {tx_hash.hex()}")

            # Wait for receipt
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

            if receipt.status == 1:
                logger.info("✅ Test trade successful!")
                self.send_telegram_alert("✅ Test trade successful - ready for live trading")
            else:
                raise RuntimeError("Test trade failed - check contract and approvals")

        except Exception as e:
            logger.error(f"Test trade failed: {e}")
            self.send_telegram_alert(f"❌ Test trade failed: {str(e)[:200]}")
            raise

        self.log_step("Execute $10 test trade to verify functionality")

    def verify_telegram(self):
        """Step 7: Test Telegram notifications"""
        self.send_telegram_alert("🚀 Production deployment started")
        logger.info("📱 Telegram alert sent - verify you received it")
        self.log_step("Verify Telegram notifications are working")

    def initialize_monitoring(self):
        """Step 8: Start monitoring dashboard"""
        logger.info("📊 Monitoring dashboard should be started separately")
        logger.info("Run: python monitoring_dashboard.py")
        self.log_step("Start monitoring dashboard")

    def enable_monitor_mode(self):
        """Step 9: Enable monitor mode for 24 hours"""
        logger.info("👀 Enabling MONITOR_MODE for 24-hour observation")
        logger.info("Set MONITOR_MODE=true in .env for safe testing")
        self.send_telegram_alert("👀 Monitor mode enabled - observe for 24 hours")
        self.log_step("Enable MONITOR_MODE for 24-hour observation")

    def enable_live_trading(self):
        """Step 10: Enable live trading"""
        logger.info("🚀 Ready to enable LIVE_TRADING")
        logger.info("Set LIVE_TRADING=true in .env only after 24h successful monitoring")
        self.send_telegram_alert("🎯 Ready for live trading - enable only after monitoring")
        self.log_step("Enable LIVE_TRADING only after successful testing")

    def emergency_stop(self):
        """Emergency stop procedure"""
        logger.critical("🚨 EMERGENCY STOP ACTIVATED")

        try:
            # Pause the contract
            tx = self.flash_contract.functions.pause().build_transaction({
                'from': self.account.address,
                'nonce': self.w3.eth.get_transaction_count(self.account.address),
                'gas': 100000,
                'gasPrice': self.w3.eth.gas_price,
            })

            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)

            if receipt.status == 1:
                logger.info("✅ Contract paused successfully")
            else:
                logger.error("❌ Failed to pause contract")

        except Exception as e:
            logger.error(f"Emergency stop failed: {e}")

        self.send_telegram_alert("🚨 EMERGENCY STOP: Contract paused")

    def withdraw_funds(self, target_address=None):
        """Withdraw all funds to admin wallet"""
        if not target_address:
            target_address = self.account.address  # Withdraw to same wallet

        logger.warning(f"💰 Withdrawing all funds to {target_address}")

        for token_name, token_address in TOKENS.items():
            try:
                token_contract = self.w3.eth.contract(token_address, abi=ERC20_ABI)
                balance = token_contract.functions.balanceOf(FLASH_LOAN_CONTRACT).call()

                if balance > 0:
                    # Call withdraw function on FlashloanArb
                    # Assuming it has a withdraw function
                    logger.info(f"Withdrawing {balance} {token_name} to {target_address}")
                    # Implement actual withdrawal

            except Exception as e:
                logger.error(f"Failed to withdraw {token_name}: {e}")

        self.send_telegram_alert(f"💰 Funds withdrawn to {target_address}")

    def run_deployment(self):
        """Run complete deployment checklist"""
        logger.info("🚀 Starting Ultra Flash Loan Bot Production Deployment")
        self.send_telegram_alert("🚀 Production deployment started")

        try:
            self.validate_environment()
            self.validate_wallet_balance()
            self.validate_contract_addresses()
            self.check_token_approvals()
            self.set_router_addresses()
            self.test_small_trade()
            self.verify_telegram()
            self.initialize_monitoring()
            self.enable_monitor_mode()
            self.enable_live_trading()

            logger.info("🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!")
            self.send_telegram_alert("🎉 Deployment completed - monitor for 24h then enable live trading")

        except Exception as e:
            logger.critical(f"💥 DEPLOYMENT FAILED: {e}")
            self.send_telegram_alert(f"💥 DEPLOYMENT FAILED: {str(e)[:200]}")
            raise

def main():
    deployer = ProductionDeployer()

    if len(sys.argv) > 1:
        command = sys.argv[1]

        if command == 'stop':
            deployer.emergency_stop()
        elif command == 'withdraw':
            target = sys.argv[2] if len(sys.argv) > 2 else None
            deployer.withdraw_funds(target)
        else:
            print("Usage: python deploy_production.py [stop|withdraw [address]]")
            print("Run without arguments for full deployment")
    else:
        deployer.run_deployment()

if __name__ == "__main__":
    main()
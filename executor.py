from web3 import Web3
from eth_account import Account
import json
import os
from decimal import Decimal
import asyncio

class ArbitrageExecutor:
    def __init__(self, private_key: str, rpc_url: str):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.account = Account.from_key(private_key)
        
        # Load contract ABIs and addresses
        with open('artifacts/contracts/FlashloanArb.sol/FlashloanArb.json') as f:
            arb_json = json.load(f)
            self.arb_abi = arb_json['abi']
            
        self.arb_address = os.getenv('ARB_CONTRACT')  # Your deployed contract address
        self.contract = self.w3.eth.contract(address=self.arb_address, abi=self.arb_abi)
        
        # Gas price settings
        self.max_gas_price = Web3.toWei(5, 'gwei')  # 5 gwei
        self.gas_refund_multiplier = Decimal('1.5')
        
    async def execute_flashswap_arbitrage(self, opportunity: dict) -> bool:
        try:
            # Estimate gas for the transaction
            estimated_gas = await self.contract.functions.executeArbitrage(
                opportunity['token0'],
                opportunity['token1'],
                opportunity['amount0'],
                opportunity['amount1']
            ).estimateGas({'from': self.account.address})
            
            # Calculate gas cost
            gas_price = min(self.w3.eth.gas_price, self.max_gas_price)
            gas_cost = estimated_gas * gas_price
            
            # Build transaction
            transaction = self.contract.functions.executeArbitrage(
                opportunity['token0'],
                opportunity['token1'],
                opportunity['amount0'],
                opportunity['amount1']
            ).buildTransaction({
                'from': self.account.address,
                'gas': int(estimated_gas * 1.1),  # Add 10% buffer
                'gasPrice': gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.account.address)
            })
            
            # Sign and send transaction
            signed_txn = self.w3.eth.account.sign_transaction(transaction, self.account.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # Wait for transaction receipt
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt['status'] == 1:
                print(f"Arbitrage successful! Tx hash: {tx_hash.hex()}")
                return True
            else:
                print(f"Arbitrage failed! Tx hash: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            print(f"Error executing arbitrage: {e}")
            return False
    
    async def execute_dodo_arbitrage(self, opportunity: dict) -> bool:
        try:
            # Similar to flashswap but using DODO's interface
            estimated_gas = await self.contract.functions.executeDodoArbitrage(
                opportunity['token0'],
                opportunity['token1'],
                opportunity['amount0'],
                opportunity['amount1']
            ).estimateGas({'from': self.account.address})
            
            gas_price = min(self.w3.eth.gas_price, self.max_gas_price)
            gas_cost = estimated_gas * gas_price
            
            transaction = self.contract.functions.executeDodoArbitrage(
                opportunity['token0'],
                opportunity['token1'],
                opportunity['amount0'],
                opportunity['amount1']
            ).buildTransaction({
                'from': self.account.address,
                'gas': int(estimated_gas * 1.1),
                'gasPrice': gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.account.address)
            })
            
            signed_txn = self.w3.eth.account.sign_transaction(transaction, self.account.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            return receipt['status'] == 1
            
        except Exception as e:
            print(f"Error executing DODO arbitrage: {e}")
            return False
    
    async def execute_opportunity(self, opportunity: dict) -> bool:
        if opportunity['type'] == 'flashswap':
            return await self.execute_flashswap_arbitrage(opportunity)
        elif opportunity['type'] == 'dodo':
            return await self.execute_dodo_arbitrage(opportunity)
        else:
            print(f"Unknown opportunity type: {opportunity['type']}")
            return False

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    private_key = os.getenv('PRIVATE_KEY')
    rpc_url = os.getenv('BSC_RPC', 'https://bsc-dataseed1.binance.org')
    
    executor = ArbitrageExecutor(private_key, rpc_url)
    
    # Example usage
    opportunity = {
        'type': 'flashswap',
        'token0': '0x55d398326f99059fF775485246999027B3197955',  # USDT
        'token1': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',  # WBNB
        'amount0': Web3.toWei(1000, 'ether'),
        'amount1': 0
    }
    
    asyncio.run(executor.execute_opportunity(opportunity))

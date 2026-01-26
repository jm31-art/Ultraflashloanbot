# test_fix.py - Run this to check if classes are accessible
import sys
sys.path.insert(0, '/Users/julianna/Ultraflashloanbot')

# Try importing the module
try:
    import final_printer_2025
    print("✅ Module loaded successfully")

    # Check if classes are defined
    classes = ['ObjectPool', 'GasPricePredictor', 'TransactionRetryManager',
               'CircuitBreakerMonitor', 'GarbageCollectionOptimizer']

    for cls in classes:
        if hasattr(final_printer_2025, cls):
            print(f"✅ {cls} is defined")
        else:
            print(f"❌ {cls} is NOT defined")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
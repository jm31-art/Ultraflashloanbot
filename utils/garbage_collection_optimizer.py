# ==================== GARBAGE COLLECTION OPTIMIZER ====================

import gc
import psutil
import os

class GarbageCollectionOptimizer:
    """
    Optimizes Python garbage collection for high-performance trading.
    Prevents memory leaks and ensures consistent performance.
    """
    
    def __init__(self, threshold_percent=80.0, aggressive_mode=False):
        self.threshold_percent = threshold_percent
        self.aggressive_mode = aggressive_mode
        self.peak_memory = 0
        self._optimize_gc_thresholds()
        print(f"✅ GarbageCollectionOptimizer initialized (threshold: {threshold_percent}%)")
    
    def _optimize_gc_thresholds(self):
        if self.aggressive_mode:
            gc.set_threshold(100, 5, 5)
        else:
            gc.set_threshold(700, 10, 10)
    
    def check_memory_usage(self):
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()
        system_memory = psutil.virtual_memory()
        memory_percent = (memory_info.rss / system_memory.total) * 100
        
        if memory_percent > self.peak_memory:
            self.peak_memory = memory_percent
        
        if memory_percent > self.threshold_percent:
            self.run_garbage_collection()
        
        return {
            'rss_mb': memory_info.rss / 1024 / 1024,
            'vms_mb': memory_info.vms / 1024 / 1024,
            'percent': memory_percent,
            'peak_percent': self.peak_memory
        }
    
    def run_garbage_collection(self, generation=None):
        if generation is not None:
            collected = gc.collect(generation)
        else:
            collected = gc.collect()
        print(f"🗑️ GC: {collected} objects collected")
        return collected
    
    def optimize_for_trading(self):
        self.run_garbage_collection()
        return self.check_memory_usage()
    
    def get_stats(self):
        return {
            'threshold_percent': self.threshold_percent,
            'peak_memory_percent': self.peak_memory,
            'gc_counts': gc.get_count()
        }
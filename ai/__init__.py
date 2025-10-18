# Add the parent directory to Python path
import os
import sys
# Get the directory containing this script
current_dir = os.path.dirname(os.path.abspath(__file__))
# Add the parent directory to sys.path
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

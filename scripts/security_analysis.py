#!/usr/bin/env python3
"""
Security analysis integration using Slither and MythX
"""

import subprocess
import json
import os
from datetime import datetime

class SecurityAnalyzer:
    """Integrated security analysis for smart contracts"""
    
    def __init__(self, contract_path="contracts/FlashloanArb.sol"):
        self.contract_path = contract_path
        self.results_dir = "security_results"
        os.makedirs(self.results_dir, exist_ok=True)
    
    def run_slither_analysis(self):
        """Run Slither static analysis"""
        try:
            print("Running Slither security analysis...")
            
            # Slither command with detailed output
            cmd = [
                "slither",
                self.contract_path,
                "--json",
                f"{self.results_dir}/slither_results.json",
                "--exclude-informational",
                "--exclude-optimization",
                "--exclude-low",
                "--triage-mode"
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                print("Slither analysis completed successfully")
                return self.parse_slither_results()
            else:
                print(f"Slither analysis failed: {result.stderr}")
                return None
                
        except subprocess.TimeoutExpired:
            print("Slither analysis timed out")
            return None
        except FileNotFoundError:
            print("Slither not installed. Install with: pip install slither-analyzer")
            return None
    
    def parse_slither_results(self):
        """Parse Slither JSON results"""
        try:
            with open(f"{self.results_dir}/slither_results.json", 'r') as f:
                results = json.load(f)
            
            critical_issues = []
            high_issues = []
            medium_issues = []
            
            for issue in results.get('results', {}).get('detectors', []):
                severity = issue.get('impact', '').lower()
                
                issue_data = {
                    'check': issue.get('check', ''),
                    'description': issue.get('description', ''),
                    'confidence': issue.get('confidence', ''),
                    'line': issue.get('elements', [{}])[0].get('source_mapping', {}).get('lines', [0])[0]
                }
                
                if severity == 'high':
                    high_issues.append(issue_data)
                elif severity == 'medium':
                    medium_issues.append(issue_data)
                elif severity == 'critical':
                    critical_issues.append(issue_data)
            
            return {
                'critical': critical_issues,
                'high': high_issues,
                'medium': medium_issues,
                'summary': {
                    'critical': len(critical_issues),
                    'high': len(high_issues),
                    'medium': len(medium_issues)
                }
            }
            
        except Exception as e:
            print(f"Error parsing Slither results: {e}")
            return None
    
    def generate_security_report(self, slither_results):
        """Generate comprehensive security report"""
        report = []
        report.append("# SECURITY ANALYSIS REPORT")
        report.append(f"Generated: {datetime.now().isoformat()}")
        report.append("")
        
        if slither_results:
            report.append("## SLITHER STATIC ANALYSIS RESULTS")
            report.append("")
            
            # Critical issues
            if slither_results['critical']:
                report.append("### CRITICAL ISSUES (MUST FIX)")
                for issue in slither_results['critical']:
                    report.append(f"- **{issue['check']}** (Line {issue['line']}): {issue['description']}")
                report.append("")
            
            # High issues
            if slither_results['high']:
                report.append("### HIGH SEVERITY ISSUES")
                for issue in slither_results['high']:
                    report.append(f"- **{issue['check']}** (Line {issue['line']}): {issue['description']}")
                report.append("")
            
            # Medium issues
            if slither_results['medium']:
                report.append("### MEDIUM SEVERITY ISSUES")
                for issue in slither_results['medium']:
                    report.append(f"- **{issue['check']}** (Line {issue['line']}): {issue['description']}")
                report.append("")
            
            report.append(f"**SUMMARY**: {slither_results['summary']['critical']} Critical, {slither_results['summary']['high']} High, {slither_results['summary']['medium']} Medium")
        
        else:
            report.append("## SECURITY ANALYSIS FAILED")
            report.append("Unable to complete security analysis. Check installation and contract path.")
        
        # Write report
        report_path = f"{self.results_dir}/security_report.md"
        with open(report_path, 'w') as f:
            f.write('\n'.join(report))
        
        print(f"Security report generated: {report_path}")
        return report_path

# INTEGRATION WITH MAIN BOT
def run_security_checks():
    """Run security analysis before deployment"""
    analyzer = SecurityAnalyzer()
    
    print("Running pre-deployment security analysis...")
    slither_results = analyzer.run_slither_analysis()
    
    if slither_results:
        report_path = analyzer.generate_security_report(slither_results)
        
        # Check for critical issues
        if slither_results['summary']['critical'] > 0:
            print("❌ CRITICAL SECURITY ISSUES FOUND. DEPLOYMENT BLOCKED.")
            print("Fix critical issues before deployment.")
            return False
        
        if slither_results['summary']['high'] > 0:
            print("⚠️  HIGH SEVERITY ISSUES FOUND. Review recommended.")
            user_input = input("Continue deployment? (y/N): ")
            if user_input.lower() != 'y':
                return False
        
        print("✅ Security analysis passed.")
        return True
    
    else:
        print("⚠️  Security analysis failed. Manual review required.")
        return False

# ADD TO DEPLOYMENT SCRIPT
if __name__ == "__main__":
    if run_security_checks():
        print("Proceeding with deployment...")
        # Deploy contract
    else:
        print("Deployment cancelled due to security concerns.")
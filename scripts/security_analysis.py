#!/usr/bin/env python3
"""
Comprehensive Security Audit Script for Ultraflashloanbot
Uses professional security analysis tools: Slither, Bandit, ESLint, Semgrep
"""

import subprocess
import json
import os
import glob
from datetime import datetime
import sys

class SecurityAnalyzer:
    """Comprehensive security analysis for the entire codebase"""

    def __init__(self):
        self.results_dir = "security_results"
        os.makedirs(self.results_dir, exist_ok=True)
        self.solidity_files = self.find_solidity_files()
        self.python_files = self.find_python_files()
        self.js_files = self.find_js_files()
        self.all_findings = []

    def find_solidity_files(self):
        """Find all Solidity contract files"""
        files = []
        for pattern in ["contracts/*.sol", "src/**/*.sol"]:
            files.extend(glob.glob(pattern, recursive=True))
        return [f for f in files if 'node_modules' not in f]

    def find_python_files(self):
        """Find all Python files"""
        files = []
        for pattern in ["**/*.py"]:
            files.extend(glob.glob(pattern, recursive=True))
        return [f for f in files if 'node_modules' not in f and '__pycache__' not in f]

    def find_js_files(self):
        """Find all JavaScript files"""
        files = []
        for pattern in ["**/*.js"]:
            files.extend(glob.glob(pattern, recursive=True))
        return [f for f in files if 'node_modules' not in f]

    def check_tool_installed(self, tool_name, install_cmd):
        """Check if a tool is installed, provide install instructions if not"""
        try:
            subprocess.run([tool_name, "--version"], capture_output=True, check=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"❌ {tool_name} not installed. Install with: {install_cmd}")
            return False

    def run_slither_analysis(self):
        """Run Slither static analysis on all Solidity files"""
        if not self.check_tool_installed("slither", "pip install slither-analyzer"):
            return None

        print("Running Slither security analysis on Solidity contracts...")
        results = []

        for sol_file in self.solidity_files:
            try:
                cmd = [
                    "slither", sol_file,
                    "--json", f"{self.results_dir}/slither_{os.path.basename(sol_file)}.json",
                    "--exclude-informational", "--exclude-optimization", "--exclude-low", "--triage-mode"
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if result.returncode == 0:
                    parsed = self.parse_slither_results(sol_file)
                    if parsed:
                        results.extend(parsed)
                else:
                    print(f"Slither failed on {sol_file}: {result.stderr}")
            except subprocess.TimeoutExpired:
                print(f"Slither timed out on {sol_file}")
            except Exception as e:
                print(f"Error running Slither on {sol_file}: {e}")

        return results

    def run_bandit_analysis(self):
        """Run Bandit security linter on all Python files"""
        if not self.check_tool_installed("bandit", "pip install bandit"):
            return None

        print("Running Bandit security analysis on Python files...")
        try:
            cmd = ["bandit", "-r", "-f", "json", "-o", f"{self.results_dir}/bandit_results.json"] + self.python_files
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode in [0, 1]:  # 0 = no issues, 1 = issues found
                return self.parse_bandit_results()
            else:
                print(f"Bandit analysis failed: {result.stderr}")
                return None
        except subprocess.TimeoutExpired:
            print("Bandit analysis timed out")
            return None
        except Exception as e:
            print(f"Error running Bandit: {e}")
            return None

    def run_eslint_analysis(self):
        """Run ESLint with security plugins on all JavaScript files"""
        if not self.check_tool_installed("eslint", "npm install -g eslint eslint-plugin-security"):
            return None

        print("Running ESLint security analysis on JavaScript files...")
        try:
            # Create .eslintrc.js if not exists
            eslintrc_path = ".eslintrc.js"
            if not os.path.exists(eslintrc_path):
                with open(eslintrc_path, 'w') as f:
                    f.write('module.exports = {\n  "extends": ["eslint:recommended"],\n  "plugins": ["security"],\n  "rules": {\n    "security/detect-buffer-noassert": "error",\n    "security/detect-child-process": "error",\n    "security/detect-disable-mustache-escape": "error",\n    "security/detect-eval-with-expression": "error",\n    "security/detect-new-buffer": "error",\n    "security/detect-no-csrf-before-method-override": "error",\n    "security/detect-non-literal-fs-filename": "error",\n    "security/detect-non-literal-regexp": "error",\n    "security/detect-non-literal-require": "error",\n    "security/detect-object-injection": "error",\n    "security/detect-possible-timing-attacks": "error",\n    "security/detect-pseudoRandomBytes": "error",\n    "security/detect-unsafe-regex": "error"\n  }\n};')

            cmd = ["eslint", "--format", "json", "--output-file", f"{self.results_dir}/eslint_results.json"] + self.js_files
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            # ESLint returns non-zero for issues, but we still parse
            return self.parse_eslint_results()
        except subprocess.TimeoutExpired:
            print("ESLint analysis timed out")
            return None
        except Exception as e:
            print(f"Error running ESLint: {e}")
            return None

    def run_semgrep_analysis(self):
        """Run Semgrep with security rules on all JavaScript files"""
        if not self.check_tool_installed("semgrep", "pip install semgrep"):
            return None

        print("Running Semgrep security analysis on JavaScript files...")
        try:
            cmd = ["semgrep", "--config", "auto", "--json", "--output", f"{self.results_dir}/semgrep_results.json"] + self.js_files
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode in [0, 1]:
                return self.parse_semgrep_results()
            else:
                print(f"Semgrep analysis failed: {result.stderr}")
                return None
        except subprocess.TimeoutExpired:
            print("Semgrep analysis timed out")
            return None
        except Exception as e:
            print(f"Error running Semgrep: {e}")
            return None

    def parse_slither_results(self, file_path):
        """Parse Slither JSON results"""
        json_file = f"{self.results_dir}/slither_{os.path.basename(file_path)}.json"
        if not os.path.exists(json_file):
            return []

        try:
            with open(json_file, 'r') as f:
                results = json.load(f)

            findings = []
            for issue in results.get('results', {}).get('detectors', []):
                severity = issue.get('impact', '').lower()
                if severity in ['critical', 'high', 'medium']:
                    findings.append({
                        'tool': 'Slither',
                        'file': file_path,
                        'severity': severity.capitalize(),
                        'type': issue.get('check', ''),
                        'description': issue.get('description', ''),
                        'line': issue.get('elements', [{}])[0].get('source_mapping', {}).get('lines', [0])[0],
                        'remediation': 'Review and fix according to Slither recommendations'
                    })
            return findings
        except Exception as e:
            print(f"Error parsing Slither results for {file_path}: {e}")
            return []

    def parse_bandit_results(self):
        """Parse Bandit JSON results"""
        json_file = f"{self.results_dir}/bandit_results.json"
        if not os.path.exists(json_file):
            return []

        try:
            with open(json_file, 'r') as f:
                results = json.load(f)

            findings = []
            for issue in results.get('results', []):
                severity = issue.get('issue_severity', '').lower()
                if severity in ['high', 'medium', 'low']:
                    findings.append({
                        'tool': 'Bandit',
                        'file': issue.get('filename', ''),
                        'severity': severity.capitalize(),
                        'type': issue.get('test_id', ''),
                        'description': issue.get('issue_text', ''),
                        'line': issue.get('line_number', 0),
                        'remediation': issue.get('issue_cwe', {}).get('link', 'Review Bandit documentation')
                    })
            return findings
        except Exception as e:
            print(f"Error parsing Bandit results: {e}")
            return []

    def parse_eslint_results(self):
        """Parse ESLint JSON results"""
        json_file = f"{self.results_dir}/eslint_results.json"
        if not os.path.exists(json_file):
            return []

        try:
            with open(json_file, 'r') as f:
                results = json.load(f)

            findings = []
            for file_result in results:
                for message in file_result.get('messages', []):
                    if 'security' in message.get('ruleId', '').lower() or message.get('severity', 0) > 1:
                        severity_map = {1: 'Low', 2: 'Medium'}
                        findings.append({
                            'tool': 'ESLint',
                            'file': file_result.get('filePath', ''),
                            'severity': severity_map.get(message.get('severity', 1), 'Medium'),
                            'type': message.get('ruleId', ''),
                            'description': message.get('message', ''),
                            'line': message.get('line', 0),
                            'remediation': 'Follow ESLint security plugin recommendations'
                        })
            return findings
        except Exception as e:
            print(f"Error parsing ESLint results: {e}")
            return []

    def parse_semgrep_results(self):
        """Parse Semgrep JSON results"""
        json_file = f"{self.results_dir}/semgrep_results.json"
        if not os.path.exists(json_file):
            return []

        try:
            with open(json_file, 'r') as f:
                results = json.load(f)

            findings = []
            for result in results.get('results', []):
                severity = result.get('extra', {}).get('severity', '').lower()
                if severity in ['error', 'warning', 'info']:
                    severity_map = {'error': 'High', 'warning': 'Medium', 'info': 'Low'}
                    findings.append({
                        'tool': 'Semgrep',
                        'file': result.get('path', ''),
                        'severity': severity_map.get(severity, 'Medium'),
                        'type': result.get('check_id', ''),
                        'description': result.get('extra', {}).get('message', ''),
                        'line': result.get('start', {}).get('line', 0),
                        'remediation': 'Review Semgrep rule documentation'
                    })
            return findings
        except Exception as e:
            print(f"Error parsing Semgrep results: {e}")
            return []

    def run_all_analyses(self):
        """Run all security analyses"""
        print("Starting comprehensive security audit...")

        slither_findings = self.run_slither_analysis() or []
        bandit_findings = self.run_bandit_analysis() or []
        eslint_findings = self.run_eslint_analysis() or []
        semgrep_findings = self.run_semgrep_analysis() or []

        self.all_findings = slither_findings + bandit_findings + eslint_findings + semgrep_findings

        return self.all_findings

    def generate_unified_report(self):
        """Generate unified security report"""
        report = []
        report.append("# COMPREHENSIVE SECURITY AUDIT REPORT")
        report.append(f"Generated: {datetime.now().isoformat()}")
        report.append("")
        report.append(f"**Files Analyzed:** {len(self.solidity_files)} Solidity, {len(self.python_files)} Python, {len(self.js_files)} JavaScript")
        report.append("")

        # Categorize findings
        critical = [f for f in self.all_findings if f['severity'] == 'Critical']
        high = [f for f in self.all_findings if f['severity'] == 'High']
        medium = [f for f in self.all_findings if f['severity'] == 'Medium']
        low = [f for f in self.all_findings if f['severity'] == 'Low']

        # Critical Issues
        if critical:
            report.append("## CRITICAL ISSUES (MUST FIX)")
            for finding in critical:
                report.append(f"- **{finding['tool']}** - {finding['file']}:{finding['line']} - {finding['type']}")
                report.append(f"  {finding['description']}")
                report.append(f"  *Remediation:* {finding['remediation']}")
            report.append("")

        # High Issues
        if high:
            report.append("## HIGH SEVERITY ISSUES")
            for finding in high:
                report.append(f"- **{finding['tool']}** - {finding['file']}:{finding['line']} - {finding['type']}")
                report.append(f"  {finding['description']}")
                report.append(f"  *Remediation:* {finding['remediation']}")
            report.append("")

        # Medium Issues
        if medium:
            report.append("## MEDIUM SEVERITY ISSUES")
            for finding in medium:
                report.append(f"- **{finding['tool']}** - {finding['file']}:{finding['line']} - {finding['type']}")
                report.append(f"  {finding['description']}")
                report.append(f"  *Remediation:* {finding['remediation']}")
            report.append("")

        # Low Issues
        if low:
            report.append("## LOW SEVERITY ISSUES")
            for finding in low:
                report.append(f"- **{finding['tool']}** - {finding['file']}:{finding['line']} - {finding['type']}")
                report.append(f"  {finding['description']}")
                report.append(f"  *Remediation:* {finding['remediation']}")
            report.append("")

        # Summary Statistics
        total_issues = len(self.all_findings)
        report.append("## SUMMARY STATISTICS")
        report.append(f"- Total Issues Found: {total_issues}")
        report.append(f"- Critical: {len(critical)}")
        report.append(f"- High: {len(high)}")
        report.append(f"- Medium: {len(medium)}")
        report.append(f"- Low: {len(low)}")
        report.append("")

        # Overall Security Score
        score = self.calculate_security_score(critical, high, medium, low)
        report.append(f"## OVERALL SECURITY SCORE: {score}/100")
        if score >= 90:
            report.append("🟢 EXCELLENT - Minimal security risks")
        elif score >= 75:
            report.append("🟡 GOOD - Some issues to address")
        elif score >= 60:
            report.append("🟠 FAIR - Multiple issues requiring attention")
        else:
            report.append("🔴 POOR - Significant security concerns")

        # Write report
        report_path = f"{self.results_dir}/comprehensive_security_report.md"
        with open(report_path, 'w') as f:
            f.write('\n'.join(report))

        print(f"Comprehensive security report generated: {report_path}")
        return report_path

    def calculate_security_score(self, critical, high, medium, low):
        """Calculate overall security score"""
        base_score = 100
        deductions = len(critical) * 20 + len(high) * 10 + len(medium) * 5 + len(low) * 1
        score = max(0, base_score - deductions)
        return score

def main():
    """Main function to run comprehensive security audit"""
    analyzer = SecurityAnalyzer()

    print("Ultraflashloanbot Security Audit")
    print("=" * 40)

    findings = analyzer.run_all_analyses()

    if findings is not None:
        report_path = analyzer.generate_unified_report()

        # Deployment blocking logic
        critical_count = len([f for f in findings if f['severity'] == 'Critical'])
        high_count = len([f for f in findings if f['severity'] == 'High'])

        if critical_count > 0:
            print("❌ CRITICAL SECURITY ISSUES FOUND. DEPLOYMENT BLOCKED.")
            print("Fix all critical issues before proceeding.")
            sys.exit(1)

        if high_count > 0:
            print("⚠️  HIGH SEVERITY ISSUES FOUND. Review recommended.")
            try:
                user_input = input("Continue? (y/N): ")
                if user_input.lower() != 'y':
                    print("Audit cancelled.")
                    sys.exit(0)
            except KeyboardInterrupt:
                print("\nAudit cancelled.")
                sys.exit(0)

        print("✅ Security audit completed successfully.")
        print(f"Report: {report_path}")
    else:
        print("⚠️  Security audit failed. Check tool installations.")
        sys.exit(1)

if __name__ == "__main__":
    main()
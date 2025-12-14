/**
 * Dynamic EXTREME MODE configuration based on UTC time
 * Risk thresholds adapt to market activity levels
 */

export function getExtremeModeConfig() {
  const hour = new Date().getUTCHours();

  // Quietest → most permissive (0:00-3:59 UTC)
  if (hour >= 0 && hour < 4) {
    return { minProfitUsd: 10, maxAttempts: 2 };
  }

  // Moderate activity (4:00-7:59 UTC)
  if (hour >= 4 && hour < 8) {
    return { minProfitUsd: 20, maxAttempts: 2 };
  }

  // Increasing activity (8:00-11:59 UTC)
  if (hour >= 8 && hour < 12) {
    return { minProfitUsd: 30, maxAttempts: 1 };
  }

  // High activity (12:00-15:59 UTC)
  if (hour >= 12 && hour < 16) {
    return { minProfitUsd: 40, maxAttempts: 1 };
  }

  // Peak activity → strict (16:00-23:59 UTC)
  return { minProfitUsd: 50, maxAttempts: 1 };
}
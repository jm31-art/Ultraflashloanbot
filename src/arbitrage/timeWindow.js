/**
 * Time-based liquidity windows for EXTREME MODE
 * Scan only during statistically inefficient periods (low liquidity)
 */

/**
 * Check if current time is within low liquidity window
 * BSC markets are typically less efficient during UTC 1:00-5:00
 */
export function isLowLiquidityWindow() {
  const now = new Date();
  const hour = now.getUTCHours();

  // Low liquidity window: 1:00-5:00 UTC
  // This is when BSC markets typically have higher inefficiencies
  return hour >= 1 && hour <= 5;
}

/**
 * Get current time window status
 */
export function getTimeWindowStatus() {
  const now = new Date();
  const hour = now.getUTCHours();
  const inWindow = isLowLiquidityWindow();

  return {
    inLowLiquidityWindow: inWindow,
    currentHour: hour,
    windowStart: 1,
    windowEnd: 5,
    nextWindowIn: inWindow ? 0 : calculateHoursToNextWindow(hour)
  };
}

/**
 * Calculate hours until next low liquidity window
 */
function calculateHoursToNextWindow(currentHour) {
  if (currentHour < 1) {
    return 1 - currentHour;
  } else if (currentHour > 5) {
    return (24 - currentHour) + 1;
  } else {
    return 0; // Already in window
  }
}

/**
 * Check if EXTREME MODE should run based on time window
 */
export function shouldRunExtremeModeByTime() {
  return isLowLiquidityWindow();
}

/**
 * Get formatted time window info for logging
 */
export function getTimeWindowInfo() {
  const status = getTimeWindowStatus();

  if (status.inLowLiquidityWindow) {
    return `✅ In low liquidity window (UTC ${status.windowStart}:00-${status.windowEnd}:00)`;
  } else {
    return `⏰ Outside low liquidity window - next window in ${status.nextWindowIn} hours`;
  }
}
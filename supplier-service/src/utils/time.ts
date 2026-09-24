/**
 * Computes whether a stall is currently open based on operating hours (24h HH:MM format)
 * evaluated against the given timezone (default: Asia/Singapore).
 *
 * Handles both:
 * - Daytime shifts: opensAt <= closesAt (e.g. 09:00 - 21:30)
 * - Overnight shifts: closesAt < opensAt (e.g. 11:00 - 02:00, spans past midnight)
 *
 * Always returns false if isActive is false.
 */
export function isOpenNow(
  opensAt: string,
  closesAt: string,
  isActive: boolean,
  referenceTime: Date = new Date(),
  timezone: string = 'Asia/Singapore'
): boolean {
  if (!isActive) {
    return false;
  }

  // Format referenceTime in the target timezone to HH:mm
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(referenceTime);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const currentTime = `${hour}:${minute}`;

  if (opensAt <= closesAt) {
    // Standard daytime shift
    return currentTime >= opensAt && currentTime <= closesAt;
  } else {
    // Overnight shift (e.g., 11:00 to 02:00)
    // Open from opensAt until midnight, OR from midnight until closesAt
    return currentTime >= opensAt || currentTime <= closesAt;
  }
}

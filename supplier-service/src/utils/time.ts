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
  timezone: string = 'Asia/Singapore',
  cutoffBufferMinutes: number = 0
): boolean {
  if (!isActive) {
    return false;
  }

  // Calculate effective closing time if a cutoff buffer is provided
  let effectiveClosesAt = closesAt;
  if (cutoffBufferMinutes > 0) {
    const [h, m] = closesAt.split(':').map(Number);
    const totalMins = (h * 60 + m - cutoffBufferMinutes + 1440) % 1440;
    const newH = Math.floor(totalMins / 60).toString().padStart(2, '0');
    const newM = (totalMins % 60).toString().padStart(2, '0');
    effectiveClosesAt = `${newH}:${newM}`;
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

  if (opensAt <= effectiveClosesAt) {
    // Standard daytime shift
    return currentTime >= opensAt && currentTime <= effectiveClosesAt;
  } else {
    // Overnight shift (e.g., 18:00 to 02:00 -> cutoff 01:45)
    return currentTime >= opensAt || currentTime <= effectiveClosesAt;
  }
}

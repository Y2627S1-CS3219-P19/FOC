import { describe, it, expect } from 'vitest';
import { isOpenNow } from '../../src/utils/time.js';

describe('Slice 1: Time Engine (isOpenNow)', () => {
  const SGT = 'Asia/Singapore';

  describe('Standard daytime hours (e.g. 09:00 - 21:30)', () => {
    const opensAt = '09:00';
    const closesAt = '21:30';

    it('returns true during operating hours (e.g. 14:00)', () => {
      // 14:00 Singapore time = 06:00 UTC
      const now = new Date('2026-09-24T06:00:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });

    it('returns false before opening time (e.g. 08:59)', () => {
      // 08:59 Singapore time = 00:59 UTC
      const now = new Date('2026-09-24T00:59:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(false);
    });

    it('returns false after closing time (e.g. 21:31)', () => {
      // 21:31 Singapore time = 13:31 UTC
      const now = new Date('2026-09-24T13:31:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(false);
    });

    it('returns true on exact opening minute boundary (09:00)', () => {
      // 09:00 Singapore time = 01:00 UTC
      const now = new Date('2026-09-24T01:00:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });

    it('returns true on exact closing minute boundary (21:30)', () => {
      // 21:30 Singapore time = 13:30 UTC
      const now = new Date('2026-09-24T13:30:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });
  });

  describe('Overnight hours spanning past midnight (e.g. 11:00 - 02:00)', () => {
    const opensAt = '11:00';
    const closesAt = '02:00';

    it('returns true during daytime before midnight (e.g. 23:30)', () => {
      // 23:30 Singapore time = 15:30 UTC
      const now = new Date('2026-09-24T15:30:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });

    it('returns true during early morning after midnight (e.g. 01:30)', () => {
      // 01:30 Singapore time = 17:30 UTC previous day
      const now = new Date('2026-09-24T17:30:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });

    it('returns false in morning outside shift (e.g. 08:00)', () => {
      // 08:00 Singapore time = 00:00 UTC
      const now = new Date('2026-09-24T00:00:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(false);
    });

    it('returns true on exact overnight closing minute boundary (02:00)', () => {
      // 02:00 Singapore time = 18:00 UTC previous day
      const now = new Date('2026-09-24T18:00:00Z');
      expect(isOpenNow(opensAt, closesAt, true, now, SGT)).toBe(true);
    });
  });

  describe('Inactive stall master switch', () => {
    it('always returns false even during open hours when isActive is false', () => {
      const now = new Date('2026-09-24T06:00:00Z'); // 14:00 SGT
      expect(isOpenNow('09:00', '21:30', false, now, SGT)).toBe(false);
    });
  });
});

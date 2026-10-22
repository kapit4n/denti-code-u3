import { describe, expect, it } from 'vitest';

import { clinicDateIso, defaultReportPeriod } from './clinic-report-period.js';

describe('clinicDateIso', () => {
  it('answers with the clinic date, not the UTC date', () => {
    // 01:30 UTC on the 1st is still the previous evening in Lima.
    expect(clinicDateIso(new Date('2026-11-01T01:30:00.000Z'), 'America/Lima')).toBe('2026-10-31');
    expect(clinicDateIso(new Date('2026-11-01T01:30:00.000Z'), 'Asia/Tokyo')).toBe('2026-11-01');
  });

  it('falls back to UTC when the clinic zone is unreadable', () => {
    expect(clinicDateIso(new Date('2026-11-01T01:30:00.000Z'), 'Not/AZone')).toBe('2026-11-01');
  });
});

describe('defaultReportPeriod', () => {
  it('runs from the first of the clinic month through today', () => {
    expect(defaultReportPeriod(new Date('2026-11-01T01:30:00.000Z'), 'America/Lima')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });
});

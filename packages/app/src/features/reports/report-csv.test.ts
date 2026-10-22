import { describe, expect, it } from 'vitest';

import type { ReportSummary } from './queries/reports-query.js';
import { buildReportCsv, reportFileName } from './report-csv.js';

const report: ReportSummary = {
  period: { from: '2026-10-01', to: '2026-10-31', timeZone: 'America/Lima', dentistId: null },
  currencyCode: 'PEN',
  appointments: {
    total: 12,
    completed: 7,
    cancelled: 1,
    noShow: 1,
    pending: 2,
    inTreatment: 1,
    bookedMinutes: 360,
  },
  production: { totalMinor: 450_000 },
  collections: { totalMinor: 230_000 },
  outstanding: { totalMinor: 220_000 },
  occupancy: { bookedMinutes: 360, capacityMinutes: 2_160, rate: 17 },
  dentists: [
    {
      dentistId: 'd1',
      dentistName: 'Dr. Book, Ana',
      appointments: 12,
      completed: 7,
      cancelled: 1,
      noShow: 1,
      pending: 2,
      inTreatment: 1,
      bookedMinutes: 360,
      productionMinor: 450_000,
      capacityMinutes: 2_160,
      occupancyRate: 17,
    },
  ],
  generatedAt: '2026-10-31T12:00:00.000Z',
};

describe('buildReportCsv', () => {
  it('writes the period, clinic figures and clinician rows', () => {
    const csv = buildReportCsv(report);

    expect(csv).toContain('Report,2026-10-01 to 2026-10-31');
    expect(csv).toContain('Production,4500.00 PEN');
    expect(csv).toContain('Collections,2300.00 PEN');
    expect(csv).toContain('Occupancy,17%');
    expect(csv).toContain('"Dr. Book, Ana",12');
    expect(csv.endsWith('17%')).toBe(true);
  });

  it('says unknown capacity is unknown rather than zero', () => {
    const csv = buildReportCsv({
      ...report,
      occupancy: { bookedMinutes: 0, capacityMinutes: null, rate: null },
    });
    expect(csv).toContain('Occupancy,Unknown');
    expect(csv).toContain('Capacity minutes,Unknown');
  });

  it('names the file by period and filter', () => {
    expect(reportFileName(report)).toBe('denti-code-report-2026-10-01_2026-10-31.csv');
    expect(reportFileName({ ...report, period: { ...report.period, dentistId: 'd1' } })).toBe(
      'denti-code-report-2026-10-01_2026-10-31-clinician.csv',
    );
  });
});

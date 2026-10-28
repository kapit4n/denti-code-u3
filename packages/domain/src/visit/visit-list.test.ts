import { describe, expect, it } from 'vitest';

import { asClinicId, asDentistId, asPatientId, asUserId, asVisitId } from '@denti-code-u3/types';
import type { DentistRepository, DentistSummary, VisitRepository } from '../ports/index.js';
import type { ClinicRole } from '../organization/roles.js';
import { listVisitsForActor, type VisitListEntry, type VisitListQuery } from './visit-list.js';

const CLINIC = asClinicId('00000000-0000-4000-8000-0000000000c1');
const USER = asUserId('00000000-0000-4000-8000-0000000000u1');
const DENTIST = asDentistId('00000000-0000-4000-8000-0000000000d1');

const ENTRY: VisitListEntry = {
  id: asVisitId('00000000-0000-4000-8000-0000000000v1'),
  patientId: asPatientId('00000000-0000-4000-8000-0000000000p1'),
  patientName: 'Ana Pérez',
  dentistId: DENTIST,
  dentistName: 'Dra. Ana Ruiz',
  status: 'COMPLETED',
  startedAt: '2026-10-20T14:00:00.000Z',
  endedAt: '2026-10-20T14:40:00.000Z',
};

function harness(options: { readonly linked?: boolean } = {}) {
  const calls: VisitListQuery[] = [];
  const lookups: string[] = [];

  const visits = {
    findById: async () => undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    listForClinic: async (_clinicId, query: VisitListQuery) => {
      calls.push(query);
      return { items: [ENTRY], total: 1 };
    },
    updateStatus: async () => {},
    save: async () => {},
  } satisfies VisitRepository;

  const dentist: DentistSummary = {
    id: DENTIST,
    userId: USER,
    fullName: 'Dra. Ana Ruiz',
    speciality: null,
    color: null,
    isActive: true,
  };

  const dentists = {
    listByClinic: async () => [dentist],
    findById: async () => dentist,
    findByUserId: async (_clinicId, userId) => {
      lookups.push(userId);
      return options.linked === false ? undefined : dentist;
    },
  } satisfies DentistRepository;

  return { calls, lookups, dependencies: { visits, dentists } };
}

describe('listVisitsForActor', () => {
  it.each(['ADMINISTRATOR', 'ASSISTANT', 'RECEPTIONIST'] as const)(
    'gives a %s the clinic directory, with no dentist filter',
    async (role: ClinicRole) => {
      const { calls, lookups, dependencies } = harness();

      const page = await listVisitsForActor(
        CLINIC,
        { userId: USER, role },
        { offset: 0, limit: 20 },
        dependencies,
      );

      expect(page.items).toEqual([ENTRY]);
      expect(page.total).toBe(1);
      // No clinician lookup: these roles are not scoped by one.
      expect(lookups).toEqual([]);
      expect(calls).toEqual([{ offset: 0, limit: 20 }]);
    },
  );

  it('narrows a dentist to the visits attributed to their clinician row', async () => {
    const { calls, lookups, dependencies } = harness();

    await listVisitsForActor(
      CLINIC,
      { userId: USER, role: 'DENTIST' },
      { offset: 20, limit: 10 },
      dependencies,
    );

    expect(lookups).toEqual([USER]);
    // The page request is forwarded untouched; only the filter is added.
    expect(calls).toEqual([{ offset: 20, limit: 10, dentistId: DENTIST }]);
  });

  it('answers an empty page for a dentist whose login has no clinician row', async () => {
    const { calls, dependencies } = harness({ linked: false });

    const page = await listVisitsForActor(
      CLINIC,
      { userId: USER, role: 'DENTIST' },
      { offset: 0, limit: 20 },
      dependencies,
    );

    // An empty page, not an error: the account exists and is allowed to ask, but
    // there is no clinician whose visits these would be.
    expect(page).toEqual({ items: [], total: 0 });
    expect(calls).toEqual([]);
  });
});

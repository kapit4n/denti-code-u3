import { agenda } from './agenda.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { patients } from './patients.js';
import { payments } from './payments.js';
import { visits } from './visits.js';

export const es = {
  ...common,
  ...dashboard,
  ...agenda,
  ...patients,
  ...payments,
  ...visits,
} as const;

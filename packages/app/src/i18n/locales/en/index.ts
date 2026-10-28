import { agenda } from './agenda.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { patients } from './patients.js';
import { visits } from './visits.js';

export const en = {
  ...common,
  ...dashboard,
  ...agenda,
  ...patients,
  ...visits,
} as const;

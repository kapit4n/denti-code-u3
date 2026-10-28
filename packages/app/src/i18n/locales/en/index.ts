import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { patients } from './patients.js';

export const en = {
  ...common,
  ...dashboard,
  ...patients,
} as const;

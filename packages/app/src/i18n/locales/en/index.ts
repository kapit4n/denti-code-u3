import { agenda } from './agenda.js';
import { auth } from './auth.js';
import { common } from './common.js';
import { dashboard } from './dashboard.js';
import { inventory } from './inventory.js';
import { odontogram } from './odontogram.js';
import { patients } from './patients.js';
import { payments } from './payments.js';
import { reports } from './reports.js';
import { settings } from './settings.js';
import { treatments } from './treatments.js';
import { visits } from './visits.js';

export const en = {
  ...common,
  ...auth,
  ...dashboard,
  ...agenda,
  ...patients,
  ...visits,
  ...payments,
  ...odontogram,
  ...treatments,
  ...inventory,
  ...reports,
  ...settings,
} as const;

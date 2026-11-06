import type { PatientOutstandingTreatment } from '@denti-code-u3/domain';
import { asTreatmentPlanId } from '@denti-code-u3/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../../i18n/index.js';
import { PatientTreatmentOverviewCard } from './patient-treatment-overview-card.js';

const TREATMENTS: readonly PatientOutstandingTreatment[] = [
  {
    id: 'item-in-progress',
    planId: asTreatmentPlanId('plan-1'),
    planStatus: 'ACCEPTED',
    title: 'Restorative plan',
    treatmentName: 'Composite restoration',
    treatmentCode: 'COMPO',
    tooth: '26',
    quantity: 1,
    estimatedPriceMinor: 30_000,
    sessionCount: 2,
  },
  {
    id: 'item-pending',
    planId: asTreatmentPlanId('plan-1'),
    planStatus: 'ACCEPTED',
    title: 'Restorative plan',
    treatmentName: 'Scaling and prophylaxis',
    treatmentCode: null,
    tooth: null,
    quantity: 1,
    estimatedPriceMinor: 12_000,
    sessionCount: 0,
  },
];

function renderCard(treatments: readonly PatientOutstandingTreatment[]) {
  render(
    <I18nProvider initialLocale="en">
      <PatientTreatmentOverviewCard treatments={treatments} />
    </I18nProvider>,
  );
}

describe('PatientTreatmentOverviewCard', () => {
  it('separates work with sessions from work that has not started', () => {
    renderCard(TREATMENTS);

    const groups = screen.getAllByTestId('patient-treatment-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent('In progress (1)');
    expect(groups[0]).toHaveTextContent('Tooth 26 · Composite restoration');
    expect(groups[0]).toHaveTextContent('2 sessions');

    expect(groups[1]).toHaveTextContent('Pending (1)');
    expect(groups[1]).toHaveTextContent('Scaling and prophylaxis');
    expect(groups[1]).not.toHaveTextContent('sessions');
  });

  it('says both groups are empty when there is no open planned work', () => {
    renderCard([]);

    expect(screen.getByText('No pending or in-progress treatment.')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-treatment-group')).not.toBeInTheDocument();
  });
});

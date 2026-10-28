/**
 * The clinic-wide odontogram at `/odontogram`.
 *
 * The chart is the same component the patient profile draws, and the section that
 * owns it is mounted here rather than reimplemented: a second chart would be a second
 * answer to "what does this tooth look like", and the two would drift the first time
 * a condition was added.
 *
 * The page starts from a patient because a tooth map belongs to one person. The
 * picker is the shared `PatientPicker`, so the names and the search behave exactly as
 * they do in the header and the booking dialog. The selection is component state, not
 * a search param, for the reason ADR-listed in T2 of `open-questions.md`: the generated
 * route tree cannot type search params in the installed router version, so a param
 * would be silently `any` and a malformed one would fail at runtime rather than at
 * compile time. A reload therefore asks again — acceptable for a working screen whose
 * unit is a tooth, not a link somebody shares.
 */

import { useState } from 'react';
import { Card, CardContent } from '@denti-code-u3/ui';

import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { PatientPicker, type SelectedPatient } from '../../patients/components/patient-picker.js';
import { PatientOdontogramSection } from '../../patients/components/patient-odontogram-section.js';

export function OdontogramPage() {
  const [patient, setPatient] = useState<SelectedPatient | undefined>(undefined);
  const { data: clinic } = useClinicSettings();

  return (
    <div className="flex flex-col gap-6" data-testid="odontogram-page">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Odontogram</h1>
        <p className="text-muted-foreground">
          Chart a patient’s teeth and read the findings already on record.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <div className="max-w-md">
            <PatientPicker id="odontogram-patient" value={patient} onChange={setPatient} />
          </div>
        </CardContent>
      </Card>

      {patient ? (
        <PatientOdontogramSection
          // A different patient is a different chart: keeping the section mounted
          // would keep its selected tooth and draft across the switch.
          key={patient.id}
          patientId={patient.id}
          clinicTimeZone={clinic?.timeZone}
        />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Choose a patient to open their odontogram.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

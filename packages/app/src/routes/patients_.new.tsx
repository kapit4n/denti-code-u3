/**
 * Registering a new patient.
 *
 * A flat sibling of `patients.tsx`, not a child: that route renders the list
 * rather than an `<Outlet />`, so a nested route would never appear. The file is
 * `patients_.new` for the same reason `patients_.$patientId` is.
 *
 * On success the assigned record number is shown here, with a link to the new
 * patient's chart. Not an automatic redirect: the number is what the front desk
 * reads out and writes on the paper file, and it has to be on screen long enough
 * to be copied before it is replaced by the chart header.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@denti-code-u3/ui';
import { ArrowLeft } from 'lucide-react';

import { PatientForm } from '../features/patients/components/patient-form.js';

export const Route = createFileRoute('/patients_/new')({
  component: NewPatient,
});

function NewPatient() {
  const [registered, setRegistered] = useState<{
    readonly id: string;
    readonly recordNumber: string;
  } | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New patient</h1>
          <p className="text-muted-foreground">
            A record number is assigned automatically when the patient is registered.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/patients">
            <ArrowLeft aria-hidden className="size-4" />
            Back to patients
          </Link>
        </Button>
      </header>

      {/*
        Reachable only after `onRegistered`, which runs in the mutation's success
        callback — so this cannot appear for a registration that failed.
      */}
      {registered ? (
        <div
          role="status"
          data-testid="register-success"
          className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-success bg-success/10 p-4"
        >
          <div>
            <p className="font-medium">
              Registered as{' '}
              <span className="font-mono" data-testid="assigned-record-number">
                {registered.recordNumber}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Open the chart to add contact details or book an appointment.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/patients/$patientId" params={{ patientId: registered.id }}>
                Open chart
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link
                to="/patients/new"
                onClick={() => {
                  setRegistered(null);
                }}
              >
                Register another
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      <PatientForm onRegistered={setRegistered} />
    </div>
  );
}

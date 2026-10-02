import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { usePatient } from '../../features/patients/hooks/use-patients.js';

export const Route = createFileRoute('/patients/$patientId')({
  component: PatientProfile,
});

function PatientProfile(): React.ReactNode {
  const { patientId } = Route.useParams();
  const { data: patient, isLoading } = usePatient(patientId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!patient) {
    return <p className="text-sm text-muted-foreground">Patient not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {patient.firstName} {patient.lastName}
        </h1>
        <p className="text-muted-foreground">Patient profile</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">Email: {patient.email || 'N/A'}</p>
          <p className="text-sm">Phone: {patient.phone || 'N/A'}</p>
          <p className="text-sm">Status: {patient.isActive ? 'Active' : 'Inactive'}</p>
        </CardContent>
      </Card>
    </div>
  );
}

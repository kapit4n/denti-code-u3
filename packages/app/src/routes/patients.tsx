import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Input, Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { usePatients } from '../features/patients/hooks/use-patients.js';
import { Search } from 'lucide-react';

export const Route = createFileRoute('/patients')({
  component: PatientsList,
});

function PatientsList(): React.ReactNode {
  const [q, setQ] = useState('');
  const { data, isLoading } = usePatients({ q });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
        <p className="text-muted-foreground">Manage patient records</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Patient List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search patients..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : data?.items?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No patients found.</p>
          ) : (
            <div className="space-y-2">
              {data?.items.map((patient) => (
                <div
                  key={patient.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {patient.firstName} {patient.lastName}
                    </p>
                    {patient.email && (
                      <p className="text-xs text-muted-foreground">{patient.email}</p>
                    )}
                  </div>
                  <span
                    className={`text-xs ${patient.isActive ? 'text-green-600' : 'text-muted-foreground'}`}
                  >
                    {patient.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

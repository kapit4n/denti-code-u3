import { useState } from 'react';
import { Input } from '@denti-code-u3/ui';
import { Search } from 'lucide-react';
import { usePatients } from '../hooks/use-patients.js';
import { useNavigate } from '@tanstack/react-router';

export function GlobalPatientSearch() {
  const [q, setQ] = useState('');
  const { data } = usePatients({ q, limit: 5 });
  const navigate = useNavigate();
  const [showResults, setShowResults] = useState(false);

  return (
    <div className="relative w-96">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search patients..."
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShowResults(true);
        }}
        onFocus={() => setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        className="pl-8"
      />
      {showResults && q && data?.items?.length ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg">
          {data.items.map((patient) => (
            <button
              key={patient.id}
              onClick={() => {
                navigate({ to: '/patients/$patientId' as any, params: { patientId: patient.id } as any });
                setQ('');
                setShowResults(false);
              }}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-muted"
            >
              {patient.firstName} {patient.lastName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

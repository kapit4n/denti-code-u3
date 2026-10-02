import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';

export function TodayAppointments() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s Appointments</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">No appointments scheduled for today.</p>
      </CardContent>
    </Card>
  );
}

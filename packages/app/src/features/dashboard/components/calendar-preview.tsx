import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { Calendar } from 'lucide-react';

export function CalendarPreview() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar Preview</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center py-8">
        <div className="flex flex-col items-center text-center">
          <Calendar className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-sm text-muted-foreground">Calendar preview coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}

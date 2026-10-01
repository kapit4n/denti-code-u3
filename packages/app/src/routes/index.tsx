/**
 * The landing route.
 *
 * Its only job is to prove the whole path works end to end: the router mounts the
 * generated route tree, the root route provides the frame, and this route renders
 * inside it. When a real feature arrives it replaces this file's contents.
 */

import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: FoundationStatus,
});

function FoundationStatus(): React.ReactNode {
  return (
    <section aria-labelledby="foundation-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 id="foundation-heading" className="text-2xl font-semibold tracking-tight">
          Foundation is mounted
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          This page is a route inside the shared application package. Both the web and the desktop
          shell render it from the same route tree, because routes live in{' '}
          <code className="font-mono text-xs">packages/app/src/routes</code> and nowhere else.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Router" value="TanStack Router, generated route tree" />
        <Fact label="State" value="TanStack Query for server data, no global store" />
        <Fact label="Transport" value="Typed REST client, base URL from VITE_API_URL" />
        <Fact label="Database" value="PostgreSQL, reached only through the API" />
      </dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

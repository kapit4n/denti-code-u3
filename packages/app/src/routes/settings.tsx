import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '../features/settings/components/settings-page.js';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

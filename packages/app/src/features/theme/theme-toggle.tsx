import { Moon, Sun } from 'lucide-react';
import { Button } from '@denti-code-u3/ui';
import { useTranslation } from '../../i18n/index.js';
import { useTheme } from './theme-provider.js';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">{t('common.theme.toggle')}</span>
    </Button>
  );
}

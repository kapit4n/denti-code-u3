import { createRoot } from 'react-dom/client';
import { AppRoot } from '@denti-code-u3/app';
import '@denti-code-u3/app/styles';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(root).render(<AppRoot />);

import { ToastProvider, ToastViewport } from './toast.js';

export function Toaster(_props: { toasts?: Array<unknown> }) {
  return (
    <ToastProvider>
      <ToastViewport />
    </ToastProvider>
  );
}

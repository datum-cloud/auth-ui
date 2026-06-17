import type { ReactNode } from 'react';

interface FormErrorProps {
  children: ReactNode;
  className?: string;
}

/**
 * Shared inline form error. role="alert" + aria-live="assertive" so screen
 * readers announce server-side validation/credential failures the moment they
 * render. Returns null when there is nothing to show, so call sites can render
 * it unconditionally with the message expression as children.
 */
export function FormError({ children, className }: FormErrorProps) {
  if (children == null || children === false) return null;
  return (
    <p
      role="alert"
      aria-live="assertive"
      className={['text-sm text-red-700', className].filter(Boolean).join(' ')}>
      {children}
    </p>
  );
}

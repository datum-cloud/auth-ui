import { AuthCard } from '@/components/auth-card/auth-card';
import { BackLink } from '@/components/back-link/back-link';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import type { AuthErrorRecovery } from '@/utils/errors/auth-error-recovery';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

// Owns the full ceremony scaffold the routes previously hand-assembled —
// AuthCard + the `flex flex-col items-baseline justify-center gap-4` layout div +
// IdentityBadge + the inline error surface + BackLink — so each verify/setup/login
// screen supplies only its title/description + the <Form.Root> body. The inline
// FormError (role="alert") replaces the per-route action-error toast, and
// AuthCeremony now owns the ceremony spacing. Composes existing components ONLY.
export interface AuthCeremonyProps {
  title: ReactNode;
  description?: ReactNode;
  /** Inline FormError (role="alert" + aria-live) — replaces per-route toasts. */
  error?: string;
  /**
   * Inline recovery affordance. When the current error code is
   * RECOVERABLE (SESSION_EXPIRED / NO_SUPPORTED_METHOD / PASSWORD_NOT_ALLOWED),
   * routes pass a `{ to, label }` descriptor and AuthCeremony renders a recovery
   * <Link> INSIDE the banner (gated on `error` being present). NO toast.
   */
  recovery?: AuthErrorRecovery;
  /** The <Form.Root>…</Form.Root> body. */
  children: ReactNode;
  loginName?: string;
  requestId?: string;
  organization?: string;
  showBackLink?: boolean;
}

// Tokenized ceremony spacing — owned here so every ceremony screen shares one rhythm
// (was previously repeated literally across the verify/setup/login routes).
const CEREMONY_LAYOUT = 'flex flex-col items-baseline justify-center gap-4';

export function AuthCeremony({
  title,
  description,
  error,
  recovery,
  children,
  loginName,
  requestId,
  organization,
  showBackLink = true,
}: AuthCeremonyProps) {
  return (
    <AuthCard title={title} description={description}>
      <div className={CEREMONY_LAYOUT}>
        {/* IdentityBadge requires a loginName (it returns null without one); only mount it
            when present so requestId/organization are threaded through "Not you?". */}
        {loginName && (
          <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />
        )}
        {/* Inline error surface (role="alert" + aria-live) — replaces the per-route toast.
            A recovery <Link> follows the message INSIDE the same banner,
            gated on both `error` and `recovery` being present (recoverable codes only). */}
        {error ? (
          <FormError>
            {error}
            {recovery ? (
              <>
                {' '}
                <Link to={recovery.to} className="underline">
                  {recovery.label}
                </Link>
              </>
            ) : null}
          </FormError>
        ) : null}
        {children}
        {showBackLink && <BackLink />}
      </div>
    </AuthCard>
  );
}

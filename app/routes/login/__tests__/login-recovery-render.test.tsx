// @vitest-environment happy-dom
//
// Inline recovery affordance on the OTP/MFA login routes that
// previously dead-ended on SESSION_EXPIRED with no recovery link.
//
// Unlike login-render.test.tsx (which stubs useAuthActionError to isolate the
// inline-vs-toast surface), this file exercises the REAL recovery pipeline
// (useAuthActionRecovery → useAuthErrorRecovery → useAuthErrorMessage) so it
// asserts the actual "Sign in again" <Link> → /login the user now sees, and that
// a non-recoverable code renders the banner with NO recovery link.
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Lingui macro is a Babel transform — passthrough so t`Sign in again` → "Sign in again".
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')), i18n: {} }),
}));

// Control the data hooks directly (useActionData only populates after a real submit).
let loaderValue: unknown;
let actionValue: unknown;
const LOGIN_CONTEXT = { loginName: 'a@b.test', requestId: 'rq1', organization: 'acme' };
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useLoaderData: () => loaderValue,
    useActionData: () => actionValue,
    useRouteLoaderData: () => LOGIN_CONTEXT,
    useNavigation: () => ({ state: 'idle' }),
  };
});

const { default: VerifyEmail } = await import('@/routes/login/verify/email');
const { default: LoginMfa } = await import('@/routes/login/mfa');

function mount(
  Component: () => ReactNode,
  path: string,
  loaderData: unknown,
  actionData?: unknown
) {
  loaderValue = loaderData;
  actionValue = actionData;
  const Stub = createRoutesStub([{ path, Component }]);
  return render(
    <ConformAdapter>
      <Stub initialEntries={[path]} />
    </ConformAdapter>
  );
}

afterEach(() => {
  cleanup();
});

describe('login/verify/email — inline recovery', () => {
  const loaderData = { csrfToken: 'tok-1', code: '', next: undefined };

  it('renders a "Sign in again" recovery link preserving the ceremony on SESSION_EXPIRED', async () => {
    mount(VerifyEmail, '/login/verify/email', loaderData, { error: 'SESSION_EXPIRED' });
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    // LOGIN_CONTEXT carries requestId/organization, so the recovery link threads them
    // back to /login — a mid-OIDC user returns to the relying party.
    expect(link.getAttribute('href')).toBe('/login?requestId=rq1&organization=acme');
    // and the inline banner is still present (recovery is additive to the message).
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders NO recovery link for a non-recoverable code (banner only)', async () => {
    mount(VerifyEmail, '/login/verify/email', loaderData, { error: 'INVALID_CREDENTIALS' });
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: 'Sign in again' })).not.toBeInTheDocument();
  });
});

describe('login/mfa — inline recovery', () => {
  const loaderData = { csrfToken: 'tok-1', secondFactors: ['otp_email'] };

  it('renders a "Sign in again" recovery link preserving the ceremony when SESSION_EXPIRED surfaces inline', async () => {
    mount(LoginMfa, '/login/mfa', loaderData, { error: 'SESSION_EXPIRED' });
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    expect(link.getAttribute('href')).toBe('/login?requestId=rq1&organization=acme');
  });

  it('renders NO recovery link for a non-recoverable code (banner only)', async () => {
    mount(LoginMfa, '/login/mfa', loaderData, { error: 'INVALID_INPUT' });
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: 'Sign in again' })).not.toBeInTheDocument();
  });
});

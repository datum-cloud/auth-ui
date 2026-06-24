// @vitest-environment happy-dom
//
// Inline action-error surface for the routes migrated off the per-route toast:
//   • accounts       → <FormError role="alert"> banner near the top of the accounts content
//   • verify/index   → <FormError role="alert"> inside the verify form
//   • device/index   → <FormError role="alert"> inside the device-code form
//
// Each route resolves actionData.error → a message via useAuthActionError and renders it
// inline (role="alert"). The toast was removed entirely; these tests pin that the banner
// renders ONLY when there is an action error (and not otherwise).
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')), i18n: {} }),
}));

// Deterministic code→message mapping so the inline-error assertions don't need the
// Lingui macro runtime.
vi.mock('@/utils/errors/auth-error-messages', () => ({
  useAuthErrorMessage: () => (code?: string) => (code ? `msg:${code}` : undefined),
}));

let loaderValue: unknown;
let actionValue: unknown;
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useLoaderData: () => loaderValue,
    useActionData: () => actionValue,
    useNavigation: () => ({ state: 'idle' }),
  };
});

const { default: AccountPicker } = await import('@/routes/accounts');
const { default: Verify } = await import('@/routes/verify/index');
const { default: Device } = await import('@/routes/device/index');
const { default: DeviceAuthorize } = await import('@/routes/device/authorize');
const { default: PasswordReset } = await import('@/routes/password/reset');

function mountAt(
  Component: () => ReactNode,
  path: string,
  loaderData: unknown,
  actionData: unknown = undefined
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
  actionValue = undefined;
});

describe('accounts — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', accounts: [] };

  it('renders the action error inline in a role="alert" banner', async () => {
    mountAt(AccountPicker, '/accounts', loaderData, { error: 'SESSION_EXPIRED' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:SESSION_EXPIRED');
  });

  it('renders NO alert banner when there is no action error', async () => {
    mountAt(AccountPicker, '/accounts', loaderData);
    await screen.findByText(/Choose an account/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('password/reset — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', organization: undefined, requestId: undefined };

  it('renders the action error inline in a role="alert" banner', async () => {
    mountAt(PasswordReset, '/password/reset', loaderData, { error: 'INVALID_INPUT' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:INVALID_INPUT');
  });

  it('renders NO alert banner when there is no action error', async () => {
    mountAt(PasswordReset, '/password/reset', loaderData);
    await screen.findByText(/Reset your password/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('verify/index — inline action error (no toast)', () => {
  const loaderData = {
    csrfToken: 't',
    userId: 'u',
    invite: undefined,
    loginName: undefined,
    organization: undefined,
    requestId: undefined,
    code: '',
  };

  it('renders the action error inline in a role="alert" banner', async () => {
    mountAt(Verify, '/verify', loaderData, { error: 'INVALID_INPUT' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:INVALID_INPUT');
  });

  it('renders NO alert banner when there is no action error', async () => {
    mountAt(Verify, '/verify', loaderData);
    await screen.findByText(/Verify your email/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('device/index — inline action error (no toast)', () => {
  const loaderData = { csrfToken: 't', userCode: '' };

  it('renders the action error inline in a role="alert" banner', async () => {
    mountAt(Device, '/device', loaderData, { error: 'NOT_FOUND' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:NOT_FOUND');
  });

  it('renders NO alert banner when there is no action error', async () => {
    mountAt(Device, '/device', loaderData);
    await screen.findByText(/Activate your device/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('device/authorize — inline ACTION error in the consent form (no toast)', () => {
  // Consent loader data (NOT the loader-recovery error path — that tailored "Code expired"
  // card is covered separately by authorize.recovery.test.tsx and stays untouched).
  const consentLoaderData = {
    csrfToken: 't',
    appName: 'Acme CLI',
    scope: ['read'],
    deviceAuthId: 'dev-1',
    requestId: 'rq-1',
    // Signed-in consent: the authorize/deny action-error path only occurs with an active
    // session (a sessionless authorize redirects to /login rather than producing an error).
    activeLoginName: 'user@example.test',
  };

  it('renders the deny/authorize action error inline in a role="alert" banner inside the consent form', async () => {
    mountAt(DeviceAuthorize, '/device/authorize', consentLoaderData, {
      error: 'FAILED_PRECONDITION',
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:FAILED_PRECONDITION');
    // The consent form is still present (this is NOT the loader-recovery card).
    expect(screen.getByRole('button', { name: /Authorize/ })).toBeInTheDocument();
  });

  it('with no active session, shows a "Sign in to continue" CTA instead of Authorize', async () => {
    mountAt(DeviceAuthorize, '/device/authorize', { ...consentLoaderData, activeLoginName: null });
    expect(await screen.findByRole('link', { name: /Sign in to continue/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Authorize/ })).not.toBeInTheDocument();
    // Deny stays available — a sessionless user can still reject an unrecognized device.
    expect(screen.getByRole('button', { name: /Deny/ })).toBeInTheDocument();
  });

  it('renders NO alert banner when there is no action error', async () => {
    mountAt(DeviceAuthorize, '/device/authorize', consentLoaderData);
    await screen.findByText(/Authorize device/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

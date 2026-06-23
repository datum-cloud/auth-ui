// @vitest-environment happy-dom
//
// login leaf routes — render adoption tests.
//
// Pins the shared-primitive adoption on the login ceremony screens:
//   - the screen is wrapped in <AuthCeremony> (it owns the tokenized ceremony layout
//     div + the inline error surface), replacing the hand-assembled
//     AuthCard + layout div + IdentityBadge + BackLink scaffold;
//   - the csrf + identity hidden inputs come from the shared <AuthFormFields> cluster
//     (CSRF_FORM_KEY === 'csrf'), in the fixed csrf → loginName → requestId → organization order;
//   - the OTP-code routes mount the schema-validated <OtpCodeField> (a datum-ui Form.Field
//     labelled control, NOT a bare input);
//   - the action-error message surfaces INLINE through <AuthCeremony error> as role="alert"
//     (toast → inline). These assertions fail against the earlier
//     toast-only implementation, which rendered no inline alert.
import Login from '@/routes/login/index';
import LoginPasskey from '@/routes/login/passkey';
import VerifyAuthenticator from '@/routes/login/verify/authenticator';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — passthrough it under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

// Toasts have a side effect (datum-ui toast singleton) that the redesigned useAuthActionError
// still fires; neutralize it so these render tests assert only the INLINE surface.
vi.mock('@datum-cloud/datum-ui/toast', () => ({ toast: { error: vi.fn() } }));

// useAuthActionError narrows actionData → resolves an i18n message → toasts → returns the
// message for inline render. Stub it so we can deterministically assert the route threads
// that message into <AuthCeremony error> (rendered as an inline role="alert"), without
// driving a real form submit through the conform adapter under happy-dom.
const mockAuthActionError = vi.fn<(d: unknown) => string | undefined>(() => undefined);
vi.mock('@/hooks/use-auth-action-error', () => ({
  useAuthActionError: (d: unknown) => mockAuthActionError(d),
}));
// The OTP/MFA verify routes moved to the recovery-aware hook. It returns
// { message, recovery }; this test only asserts the inline MESSAGE surface, so map the
// same mock fn onto `message` and leave `recovery` undefined (no recovery link asserted here).
vi.mock('@/hooks/use-auth-action-recovery', () => ({
  useAuthActionRecovery: (d: unknown) => ({ message: mockAuthActionError(d), recovery: undefined }),
}));

// The login identity context is hoisted into the `login` parent route and read via
// useRouteLoaderData('login'); the stub must expose a route with id: 'login' providing it.
const LOGIN_CONTEXT = {
  loginName: 'alice@acme.test',
  requestId: 'rq-123',
  organization: 'acme',
};

const OTP_LOADER_DATA = { csrfToken: 'csrf-token-xyz' };

const PASSKEY_LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  loginName: 'alice@acme.test',
  requestId: 'rq-123',
  organization: 'acme',
  publicKeyCredentialRequestOptions: null,
};

function renderRoute(
  path: string,
  Component: () => ReactNode,
  loaderData: unknown,
  actionData?: unknown
) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([
    {
      id: 'login',
      path: '/login',
      loader: () => LOGIN_CONTEXT,
      children: [
        {
          path: path.replace('/login/', ''),
          Component: () => <Component />,
          loader: () => loaderData,
          action: () => actionData ?? null,
        },
      ],
    },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <ConformAdapter>
        <Stub initialEntries={[path]} />
      </ConformAdapter>
    </I18nProvider>
  );
}

describe('login/verify/authenticator — render adoption', () => {
  it('wraps the screen in the AuthCeremony layout (owned tokenized spacing div)', async () => {
    const { container } = renderRoute(
      '/login/verify/authenticator',
      VerifyAuthenticator,
      OTP_LOADER_DATA
    );
    await screen.findByText('alice@acme.test', { exact: false });
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
  });

  it('emits the shared csrf + identity hidden inputs from AuthFormFields in fixed order', async () => {
    const { container } = renderRoute(
      '/login/verify/authenticator',
      VerifyAuthenticator,
      OTP_LOADER_DATA
    );
    await screen.findByText('alice@acme.test', { exact: false });
    const hidden = Array.from(container.querySelectorAll('form input[type="hidden"]')).map((i) => ({
      name: i.getAttribute('name'),
      value: i.getAttribute('value'),
    }));
    // CSRF_FORM_KEY === 'csrf'; the cluster is csrf → loginName → requestId → organization.
    expect(hidden).toEqual([
      { name: 'csrf', value: 'csrf-token-xyz' },
      { name: 'loginName', value: 'alice@acme.test' },
      { name: 'requestId', value: 'rq-123' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('mounts the schema-validated OtpCodeField (datum-ui Form.Field, not a bare input)', async () => {
    renderRoute('/login/verify/authenticator', VerifyAuthenticator, OTP_LOADER_DATA);
    const input = (await screen.findByLabelText(/Authenticator code/)) as HTMLInputElement;
    expect(input.getAttribute('name')).toBe('code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    // Discriminator: a datum-ui Form.Input carries data-slot="input" (not a hand-rolled input).
    expect(input.getAttribute('data-slot')).toBe('input');
  });

  it('threads the resolved action-error message INLINE as role="alert" (toast → inline)', async () => {
    // The redesigned route passes useAuthActionError(actionData) into <AuthCeremony error>;
    // AuthCeremony renders it as an inline FormError (role="alert"). Earlier the message was
    // toast-only with no inline alert, so this assertion fails against the old implementation.
    mockAuthActionError.mockReturnValueOnce('Incorrect credentials. Please try again.');
    renderRoute('/login/verify/authenticator', VerifyAuthenticator, OTP_LOADER_DATA);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Incorrect credentials. Please try again.');
    // and the route consulted the shared action-error hook (not the old toast pipeline).
    expect(mockAuthActionError).toHaveBeenCalled();
  });
});

describe('login/passkey — render adoption', () => {
  it('wraps the screen in AuthCeremony and emits the AuthFormFields cluster + the credential input', async () => {
    const { container } = renderRoute('/login/passkey', LoginPasskey, PASSKEY_LOADER_DATA);
    await screen.findByText('alice@acme.test', { exact: false });
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
    const hidden = Array.from(container.querySelectorAll('form input[type="hidden"]')).map((i) =>
      i.getAttribute('name')
    );
    // identity cluster from AuthFormFields, then the route-specific credential input.
    expect(hidden).toEqual(['csrf', 'loginName', 'requestId', 'organization', 'credential']);
  });
});

// ── login/index (the SplitLayout welcome chooser) — primitive adoption ────
//
// /login is NOT an AuthCeremony screen: it is the full SplitLayout welcome page (the
// multi-method chooser). It adopts the AuthFormFields hidden-input cluster on BOTH
// forms (the IdP form + the revealed identifier form) and surfaces the action error
// INLINE through <FormError role="alert"> (toast → inline). These assertions fail against
// the earlier raw-hidden-input + toast-only implementation, which rendered no inline alert.

const LOGIN_INDEX_LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  // One active IdP so the IdP <RRForm> renders (showIdpButtons = allowExternalIdp && idps>0).
  idps: [{ id: 'idp-1', name: 'Google' }],
  settings: {
    allowPassword: true,
    allowRegister: true,
    allowExternalIdp: true,
    passkeysType: 'not_allowed',
    disableLoginWithEmail: false,
    disableLoginWithPhone: false,
  },
  branding: null,
  emailDeliveryEnabled: false,
  notice: undefined,
  lastUsedLogin: null,
};

function renderLoginIndex(
  actionData?: unknown,
  loaderOverride?: Partial<typeof LOGIN_INDEX_LOADER_DATA>
) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const loaderData = { ...LOGIN_INDEX_LOADER_DATA, ...loaderOverride };
  const Stub = createRoutesStub([
    {
      id: 'login',
      path: '/login',
      loader: () => LOGIN_CONTEXT,
      children: [
        {
          index: true,
          Component: () => <Login />,
          loader: () => loaderData,
          action: () => actionData ?? null,
        },
      ],
    },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <ConformAdapter>
        <Stub initialEntries={['/login']} />
      </ConformAdapter>
    </I18nProvider>
  );
}

describe('login/index — render adoption', () => {
  it('emits the AuthFormFields identity cluster (csrf → requestId → organization) on the IdP form', async () => {
    const { container } = renderLoginIndex();
    // createRoutesStub resolves the loader async — wait for the IdP button before querying.
    await screen.findByText('Google');
    // The IdP form is the first <form>; it carries the shared cluster + the idp intent inputs.
    const idpForm = container.querySelector('form');
    expect(idpForm).not.toBeNull();
    const hidden = Array.from(idpForm!.querySelectorAll('input[type="hidden"]')).map((i) => ({
      name: i.getAttribute('name'),
      value: i.getAttribute('value'),
    }));
    // AuthFormFields cluster first (no loginName on this form), then the IdP intent + id.
    expect(hidden).toEqual([
      { name: 'csrf', value: 'csrf-token-xyz' },
      { name: 'requestId', value: 'rq-123' },
      { name: 'organization', value: 'acme' },
      { name: 'intent', value: 'idp' },
      { name: 'idpId', value: 'idp-1' },
    ]);
  });

  it('emits the AuthFormFields cluster on the revealed identifier form (no loginName hidden input)', async () => {
    renderLoginIndex();
    // The identifier form is gated behind the "Email" reveal button; wait for it, then
    // click it to mount the form.
    const emailButton = await screen.findByText('Email');
    fireEvent.click(emailButton);
    const forms = Array.from(document.querySelectorAll('form'));
    const idForm = forms.find((f) => f.querySelector('input[name="loginName"]'));
    expect(idForm).toBeDefined();
    const hidden = Array.from(idForm!.querySelectorAll('input[type="hidden"]')).map((i) => ({
      name: i.getAttribute('name'),
      value: i.getAttribute('value'),
    }));
    // loginName here is the VISIBLE Form.Field text input, NOT a hidden input — the
    // AuthFormFields cluster on this form is csrf → requestId → organization only.
    expect(hidden).toEqual([
      { name: 'csrf', value: 'csrf-token-xyz' },
      { name: 'requestId', value: 'rq-123' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('surfaces the action-error message INLINE as role="alert" (toast → inline, the intended /login re-baseline)', async () => {
    mockAuthActionError.mockReturnValueOnce('We could not find an account with that email.');
    renderLoginIndex({ error: 'USER_NOT_FOUND' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not find an account with that email.');
    // and the route consulted the shared action-error hook (not the old toast pipeline).
    expect(mockAuthActionError).toHaveBeenCalled();
  });

  // F2: the social/IdP buttons are DRIVEN BY the configured IdPs (the loader's `idps`), so a
  // provider button renders ONLY when that provider is configured. No Google IdP ⇒ no Google
  // button. The Email + Create-account options stay unconditional.
  describe('F2 — IdP buttons render only for configured providers', () => {
    it('renders the configured Google IdP button when one Google IdP is active', async () => {
      renderLoginIndex(undefined, { idps: [{ id: 'idp-1', name: 'Google' }] });
      expect(await screen.findByRole('button', { name: 'Google' })).toBeInTheDocument();
    });

    it('renders NO Google/social IdP button when no IdP is configured (idps empty)', async () => {
      renderLoginIndex(undefined, { idps: [] });
      // The unconditional Email reveal button is the marker the page rendered.
      expect(await screen.findByText('Email')).toBeInTheDocument();
      // No provider button is present — specifically no Google button.
      expect(screen.queryByRole('button', { name: 'Google' })).not.toBeInTheDocument();
      // Email + Create-account stay available regardless of IdP config.
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Create account')).toBeInTheDocument();
    });
  });
});

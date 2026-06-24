// @vitest-environment happy-dom
//
// Setup-domain render sweep: locks in adoption of the shared primitives across the
// six setup leaf routes. These assertions FAIL against the pre-sweep routes (raw csrf +
// identity inputs, AuthCard scaffold, action-error TOAST) and PASS once each route
// adopts <AuthFormFields>/<AuthCeremony error>/<OtpCodeField>.
//
// What is locked here:
//   1. The csrf + identity hidden-input cluster is byte-identical (CSRF_FORM_KEY==='csrf',
//      fixed order, undefined skipped) — i.e. routed through <AuthFormFields>.
//   2. The intended visual change: an action error renders INLINE as <FormError role="alert">
//      (surfaced through <AuthCeremony error>), not as a toast.
//   3. The OTP enroll/verify-code routes (email/sms/authenticator) field is the datum-ui
//      <OtpCodeField> (data-slot="input" + numeric/one-time-code), never a bare input.
//   4. <BackLink> renders after the form body (ceremony scaffold owned by AuthCeremony).
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Neutralize the Lingui macro (vitest does not run the Lingui transform) — repo convention.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')), i18n: {} }),
}));

// WebAuthnButton talks to navigator.credentials; render-stub it to a labelled button so the
// passkey/security-key forms mount in happy-dom without a real authenticator.
vi.mock('@/components/webauthn-button/webauthn-button', () => ({
  WebAuthnButton: ({ label }: { label: ReactNode }) => <button type="submit">{label}</button>,
}));

// useActionData only populates after a real navigation/submission inside a router; to render a
// route component WITH a server error in a unit test we control the data hooks directly. The
// Router context (Link/useLocation in IdentityBadge/BackLink) still comes from createRoutesStub.
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

// Imported AFTER the mocks above so the routes pick up the mocked react-router hooks.
const { default: SetupAuthenticator } = await import('@/routes/setup/authenticator');
const { default: SetupEmail } = await import('@/routes/setup/email');
const { default: SetupMfa } = await import('@/routes/setup/mfa');
const { default: SetupPasskey } = await import('@/routes/setup/passkey');
const { default: SetupSecurityKey } = await import('@/routes/setup/security-key');
const { default: SetupSms } = await import('@/routes/setup/sms');

const hidden = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('input[type=hidden]')).map((i) => ({
    name: i.getAttribute('name'),
    value: i.getAttribute('value'),
  }));

/** Mount a setup route's default component at /setup/<seg> with controlled loader/action data. */
function mountRoute(
  Component: () => ReactNode,
  segment: string,
  loaderData: unknown,
  actionData?: unknown
) {
  loaderValue = loaderData;
  actionValue = actionData;
  const Stub = createRoutesStub([{ path: `/setup/${segment}`, Component }]);
  // ConformAdapter satisfies the datum-ui Form.Root adapter requirement (OtpCodeField routes).
  return render(
    <ConformAdapter>
      <Stub initialEntries={[`/setup/${segment}`]} />
    </ConformAdapter>
  );
}

const IDENTITY = {
  csrfToken: 'tok-1',
  loginName: 'a@b.test',
  requestId: 'rq1',
  organization: 'acme',
  force: undefined as 'true' | 'false' | undefined,
  checkAfter: undefined as 'true' | 'false' | undefined,
};

beforeEach(() => {
  loaderValue = undefined;
  actionValue = undefined;
});

// Explicit unmount between tests — auto-cleanup is not wired via globals in this config,
// so without it a prior render's DOM stays mounted and findBy* matches duplicate nodes.
afterEach(() => {
  cleanup();
});

describe('setup/email — shared primitive adoption', () => {
  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', async () => {
    const { container } = mountRoute(SetupEmail, 'email', { ...IDENTITY });
    await screen.findByText(/Set up email one-time code/);
    // Order is fixed: csrf, loginName, requestId, organization (force/checkAfter undefined → skipped).
    expect(hidden(container)).toEqual([
      { name: 'csrf', value: 'tok-1' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'rq1' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('surfaces an action error inline (role="alert"), not as a toast', async () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });

  // A SESSION_EXPIRED dead-end now offers an inline "Sign in again" recovery
  // <Link> → /login inside the banner. Behavior otherwise unchanged.
  it('renders an inline "Sign in again" recovery link to /login on SESSION_EXPIRED', async () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('mounts the IdentityBadge for the threaded loginName (ceremony scaffold owned)', async () => {
    mountRoute(SetupEmail, 'email', { ...IDENTITY });
    expect(await screen.findByText('a@b.test')).toBeInTheDocument();
  });
});

describe('setup/sms — shared primitive adoption', () => {
  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', async () => {
    const { container } = mountRoute(SetupSms, 'sms', { ...IDENTITY });
    await screen.findByText(/Set up SMS one-time code/);
    expect(hidden(container)).toEqual([
      { name: 'csrf', value: 'tok-1' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'rq1' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('surfaces an action error inline (role="alert")', async () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders an inline "Sign in again" recovery link to /login on SESSION_EXPIRED', async () => {
    mountRoute(SetupSms, 'sms', { ...IDENTITY }, { error: 'SESSION_EXPIRED' });
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});

describe('setup/authenticator — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, uri: 'otpauth://totp/x', secret: 'ABC123' };

  it('emits byte-identical csrf + identity hidden inputs via AuthFormFields', async () => {
    const { container } = mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    await screen.findByText(/Set up authenticator app/);
    expect(hidden(container)).toEqual([
      { name: 'csrf', value: 'tok-1' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'rq1' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('renders the OTP code field as a datum-ui OtpCodeField (not a bare input)', async () => {
    const { container } = mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    const input = (await screen.findByLabelText(/Authenticator code/)) as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    // Discriminator: datum-ui Form.Input carries data-slot="input" wired to a Form.Field label.
    expect(input.getAttribute('data-slot')).toBe('input');
    const label = container.querySelector('label[data-slot="label"]');
    expect(label?.getAttribute('for')).toBe(input.id);
  });

  it('surfaces an action error inline (role="alert")', async () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData, { error: 'INVALID_CREDENTIALS' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // A NON-recoverable code renders the banner with NO recovery link.
  it('renders NO recovery link for a non-recoverable code (banner only)', async () => {
    mountRoute(SetupAuthenticator, 'authenticator', loaderData, { error: 'INVALID_CREDENTIALS' });
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: 'Sign in again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start over' })).not.toBeInTheDocument();
  });

  // The otpauth URI is rendered as a scannable QR (qrcode.react QRCodeSVG)
  // ABOVE the existing manual-key fallback — the fallback (raw secret + URI) stays.
  it('renders a scannable QR for the otpauth URI above the manual-key fallback', async () => {
    const { container } = mountRoute(SetupAuthenticator, 'authenticator', loaderData);
    await screen.findByText(/Set up authenticator app/);

    // QRCodeSVG renders an <svg>; we tag it for a stable hook.
    const qr = container.querySelector('[data-testid="totp-qr"]');
    expect(qr).toBeInTheDocument();
    expect(qr?.tagName.toLowerCase()).toBe('svg');

    // The manual-key fallback is preserved (raw secret + the otpauth URI string).
    expect(container.querySelector('[data-testid="totp-secret"]')?.textContent).toBe('ABC123');
    expect(container.querySelector('[data-testid="totp-uri"]')?.textContent).toBe(
      'otpauth://totp/x'
    );

    // The QR precedes the manual fallback in document order (rendered ABOVE it).
    const fallback = container.querySelector('[data-testid="totp-uri"]');
    expect(qr && fallback && qr.compareDocumentPosition(fallback)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

describe('setup/passkey — shared primitive adoption', () => {
  // The shared enroll factory unifies passkeyId/u2fId into `credentialId`.
  const loaderData = {
    ...IDENTITY,
    credentialId: 'pk1',
    publicKey: {},
    challengeFailed: false,
  };

  it('emits csrf + identity + passkeyId/credential hidden inputs (identity via AuthFormFields)', async () => {
    const { container } = mountRoute(SetupPasskey, 'passkey', loaderData);
    await screen.findByText(/Set up passkey/);
    const names = hidden(container).map((h) => h.name);
    // AuthFormFields contributes csrf/loginName/requestId/organization in fixed order;
    // the route keeps its own passkeyId + credential inputs.
    expect(names).toContain('csrf');
    expect(names).toContain('loginName');
    expect(names).toContain('requestId');
    expect(names).toContain('organization');
    expect(names).toContain('passkeyId');
    expect(names).toContain('credential');
  });

  it('surfaces an action error inline (role="alert")', async () => {
    mountRoute(SetupPasskey, 'passkey', loaderData, { error: 'INVALID_CREDENTIALS' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('setup/security-key — shared primitive adoption', () => {
  // credentialId carries the U2F id; the route renders the `u2fId` hidden input.
  const loaderData = { ...IDENTITY, credentialId: 'u1', publicKey: {}, challengeFailed: false };

  it('emits csrf + identity + u2fId/credential hidden inputs (identity via AuthFormFields)', async () => {
    const { container } = mountRoute(SetupSecurityKey, 'security-key', loaderData);
    // h1 and the submit button share the copy; scope to the heading to disambiguate.
    await screen.findByRole('heading', { name: /Set up security key/ });
    const names = hidden(container).map((h) => h.name);
    expect(names).toContain('csrf');
    expect(names).toContain('loginName');
    expect(names).toContain('requestId');
    expect(names).toContain('organization');
    expect(names).toContain('u2fId');
    expect(names).toContain('credential');
  });

  it('surfaces an action error inline (role="alert")', async () => {
    mountRoute(SetupSecurityKey, 'security-key', loaderData, { error: 'INVALID_CREDENTIALS' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('setup/mfa — shared primitive adoption', () => {
  const loaderData = { ...IDENTITY, offerableKeys: ['passkey', 'emailOtp'] };

  it('emits byte-identical csrf + identity hidden inputs in the Skip form via AuthFormFields', async () => {
    const { container } = mountRoute(SetupMfa, 'mfa', loaderData);
    await screen.findByText(/Set up multi-factor authentication/);
    // The chooser links + the Skip POST form; only the Skip form carries hidden inputs.
    expect(hidden(container)).toEqual([
      { name: 'csrf', value: 'tok-1' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'rq1' },
      { name: 'organization', value: 'acme' },
    ]);
  });

  it('threads the shared query string into each chooser link (byte-identical /setup/<seg> URLs)', async () => {
    mountRoute(SetupMfa, 'mfa', loaderData);
    const passkeyLink = await screen.findByRole('link', { name: 'Passkey' });
    const href = passkeyLink.getAttribute('href') ?? '';
    expect(href).toMatch(/^\/setup\/passkey\?/);
    expect(href).toContain('loginName=a%40b.test');
    expect(href).toContain('requestId=rq1');
    expect(href).toContain('organization=acme');
  });

  it('surfaces an action error inline (role="alert")', async () => {
    mountRoute(SetupMfa, 'mfa', loaderData, { error: 'SESSION_EXPIRED' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders an inline "Sign in again" recovery link to /login on SESSION_EXPIRED', async () => {
    mountRoute(SetupMfa, 'mfa', loaderData, { error: 'SESSION_EXPIRED' });
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  // F4: the "Authenticator app" method link must have a SINGLE accessible name (its visible
  // text). Its <img> icon must be decorative (alt="" + aria-hidden) so a screen reader does not
  // announce the name twice ("Authenticator app Authenticator app").
  describe('F4 — Authenticator app link is announced once (decorative icon)', () => {
    const totpLoader = { ...IDENTITY, offerableKeys: ['totpOtp', 'emailOtp'] };

    it('exposes exactly one link named "Authenticator app" (no doubled accessible name)', async () => {
      mountRoute(SetupMfa, 'mfa', totpLoader);
      // getByRole's accessible-name match is exact: a doubled name ("Authenticator app
      // Authenticator app") would NOT match, so this pins the single-announcement contract.
      const link = await screen.findByRole('link', { name: 'Authenticator app' });
      expect(link).toBeInTheDocument();
    });

    it('renders the Authenticator icon as a decorative img (alt="" + aria-hidden)', async () => {
      const { container } = mountRoute(SetupMfa, 'mfa', totpLoader);
      await screen.findByRole('link', { name: 'Authenticator app' });
      const img = container.querySelector('img[src*="totp.png"]');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('alt')).toBe('');
      expect(img?.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

// Once previous-step.ts maps the /setup/* paths, AuthCeremony's <BackLink/> resolves a
// target and renders — EXCEPT on the setup/mfa entry step, which passes showBackLink={false}
// to suppress it (covered by the negative case below). createRoutesStub mounts each route at
// /setup/<segment>, so useLocation().pathname drives previousStepFor.
describe('setup/* — BackLink renders to the predecessor', () => {
  const cases: Array<[name: string, Component: () => ReactNode, segment: string, loader: unknown]> =
    [
      [
        'authenticator',
        SetupAuthenticator,
        'authenticator',
        { ...IDENTITY, uri: 'otpauth://totp/x', secret: 'ABC123' },
      ],
      ['email', SetupEmail, 'email', { ...IDENTITY }],
      ['sms', SetupSms, 'sms', { ...IDENTITY }],
      [
        'passkey',
        SetupPasskey,
        'passkey',
        { ...IDENTITY, credentialId: 'pk1', publicKey: {}, challengeFailed: false },
      ],
      [
        'security-key',
        SetupSecurityKey,
        'security-key',
        { ...IDENTITY, credentialId: 'u1', publicKey: {}, challengeFailed: false },
      ],
    ];

  it.each(cases)(
    'setup/%s renders a Back link to its predecessor (/setup/mfa or /login/password)',
    async (_name, Component, segment, loader) => {
      const { container } = mountRoute(Component, segment, loader);
      const links = Array.from(container.querySelectorAll('a')).map(
        (a) => a.getAttribute('href') ?? ''
      );
      const back = links.find((h) => h.startsWith('/setup/mfa') || h.startsWith('/login/password'));
      expect(back).toBeDefined();
    }
  );

  // setup/mfa is the ENTRY step of MFA enrollment, so it suppresses the BackLink
  // (showBackLink={false} in app/routes/setup/mfa.tsx) — the method screens above keep theirs.
  it('setup/mfa suppresses the Back link (entry step — showBackLink=false)', () => {
    const { container } = mountRoute(SetupMfa, 'mfa', { ...IDENTITY, offerableKeys: ['passkey'] });
    const links = Array.from(container.querySelectorAll('a')).map(
      (a) => a.getAttribute('href') ?? ''
    );
    const back = links.find((h) => h.startsWith('/login/password'));
    expect(back).toBeUndefined();
  });
});

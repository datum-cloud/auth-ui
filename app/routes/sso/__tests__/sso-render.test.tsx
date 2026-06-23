// @vitest-environment happy-dom
//
// Sweep render tests for the sso ceremony/management leaf routes. These pin the
// shared-primitive adoption and the BYTE-FROZEN hidden-input + URL surfaces:
//   • ldap   → AuthCeremony (owned layout div) + AuthFormFields (csrf/requestId/organization)
//              + idpId kept raw; action error surfaced INLINE (role="alert"), not as a toast.
//   • index  → the 3 management forms keep their csrf hidden input byte-identical
//              (name="csrf"); the plain loginName <p> is preserved (NOT an IdentityBadge —
//              this is a management screen, not an identity ceremony).
//   • error  → "Back to sign in" link resolves to /id/login (paths.login.index(), basename
//              auto-prefixed by RR <Link>) — byte-identical to the old "/login" literal.
//
// These tests are NON-tautological: they fail if the csrf input name drifts, if the
// AuthCeremony layout/inline-error surface regresses, or if the login URL changes.
import SsoIndex from '@/routes/sso/index';
import SsoLdap from '@/routes/sso/ldap';
import SsoError from '@/routes/sso/provider/error';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — not run under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

// Toast→inline redesign: the leaf sso routes resolve their action error through
// useAuthActionError and render it inline via <FormError> in <AuthCeremony error>
// (the sole error surface). The per-route toast was removed entirely.
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function renderRoute(
  Component: () => ReactNode,
  {
    path,
    initial,
    loaderData,
    actionData,
  }: { path: string; initial: string; loaderData?: unknown; actionData?: unknown }
) {
  const Stub = createRoutesStub([
    {
      path,
      Component,
      loader: loaderData !== undefined ? () => loaderData : undefined,
      action: actionData !== undefined ? () => actionData : undefined,
    },
  ]);
  return render(
    <ConformAdapter>
      <I18nProvider i18n={i18n}>
        <Stub initialEntries={[initial]} />
      </I18nProvider>
    </ConformAdapter>
  );
}

// ── sso/ldap ──────────────────────────────────────────────────────────────────

describe('SsoLdap — AuthCeremony + AuthFormFields adoption', () => {
  const loaderData = {
    csrfToken: 'csrf-ldap',
    idpId: 'idp-99',
    requestId: 'rq-7',
    organization: 'acme',
  };

  it('emits the byte-frozen hidden inputs: csrf (name="csrf"), idpId, requestId, organization', async () => {
    const { container } = renderRoute(() => <SsoLdap />, {
      path: '/sso/ldap',
      initial: '/sso/ldap',
      loaderData,
    });
    await screen.findByText('Sign in with LDAP');

    const csrf = container.querySelector('input[name="csrf"]') as HTMLInputElement;
    expect(csrf).not.toBeNull();
    expect(csrf.value).toBe('csrf-ldap');

    const idpId = container.querySelector('input[name="idpId"]') as HTMLInputElement;
    expect(idpId?.value).toBe('idp-99');

    const requestId = container.querySelector('input[name="requestId"]') as HTMLInputElement;
    expect(requestId?.value).toBe('rq-7');

    const organization = container.querySelector('input[name="organization"]') as HTMLInputElement;
    expect(organization?.value).toBe('acme');
  });

  it('renders inside the AuthCeremony owned layout div with the tokenized spacing class', async () => {
    const { container } = renderRoute(() => <SsoLdap />, {
      path: '/sso/ldap',
      initial: '/sso/ldap',
      loaderData,
    });
    await screen.findByText('Sign in with LDAP');
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
    // The username/password fields live inside the owned ceremony layout.
    expect(within(layout as HTMLElement).getByLabelText(/Username/)).toBeInTheDocument();
  });

  it('keeps the username + password fields (not reduced to a bare form)', async () => {
    renderRoute(() => <SsoLdap />, { path: '/sso/ldap', initial: '/sso/ldap', loaderData });
    await screen.findByText('Sign in with LDAP');
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/)).toBeInTheDocument();
  });
});

// ── sso/index ───────────────────────────────────────────────────────────────────

describe('SsoIndex — AuthFormFields csrf adoption is render-identical', () => {
  const loaderData = {
    csrfToken: 'csrf-mgmt',
    userId: 'u1',
    loginName: 'you@acme.test',
    linked: [{ idpId: 'g', idpUserId: 'gx', idpUserName: 'Google You' }],
    unlinked: [{ id: 'gh', name: 'GitHub' }],
    allowUnlink: true,
  };

  it('every management form carries a byte-frozen csrf hidden input (name="csrf")', async () => {
    const { container } = renderRoute(() => <SsoIndex />, {
      path: '/sso',
      initial: '/sso',
      loaderData,
    });
    await screen.findByText('Linked accounts');
    const csrfInputs = container.querySelectorAll('input[name="csrf"]');
    // unlink form + start form + sign-out form = 3 csrf inputs, all value-frozen.
    expect(csrfInputs.length).toBe(3);
    csrfInputs.forEach((el) => expect((el as HTMLInputElement).value).toBe('csrf-mgmt'));
  });

  it('renders loginName as a plain paragraph (management screen, not an IdentityBadge)', async () => {
    renderRoute(() => <SsoIndex />, { path: '/sso', initial: '/sso', loaderData });
    await screen.findByText('Linked accounts');
    expect(screen.getByText('you@acme.test')).toBeInTheDocument();
    // No "Signing in as … Not you?" identity-ceremony badge on the management page.
    expect(screen.queryByText(/Not you\?/)).not.toBeInTheDocument();
  });

  it('keeps the native sign-out form posting to the byte-frozen /id/logout?index action', async () => {
    const { container } = renderRoute(() => <SsoIndex />, {
      path: '/sso',
      initial: '/sso',
      loaderData,
    });
    await screen.findByText('Linked accounts');
    const signOut = container.querySelector('form[action="/id/logout?index"]');
    expect(signOut).not.toBeNull();
  });
});

// ── sso/provider/error ────────────────────────────────────────────────────────

describe('SsoError — typed paths.login.index() emits the byte-frozen login URL', () => {
  // createRoutesStub does not apply the runtime /id/ basename, so the rendered href is
  // "/login" — identical to what the old "/login" literal produced. This pins that
  // paths.login.index() emits a byte-identical URL (the RR basename auto-prefix to
  // /id/login happens at runtime, not in the stub).
  it('"Back to sign in" link resolves to the byte-frozen /login URL', async () => {
    renderRoute(() => <SsoError />, {
      path: '/sso/:provider/error',
      initial: '/sso/google/error?reason=access-denied',
    });
    const back = await screen.findByRole('link', { name: /Back to sign in/ });
    expect(back.getAttribute('href')).toBe('/login');
  });
});

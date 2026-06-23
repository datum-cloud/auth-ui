// @vitest-environment happy-dom
//
// signup/index — render adoption tests.
//
// Pins the shared-primitive adoption on the signup identifier screen:
//   - the csrf + identity hidden inputs come from the shared <AuthFormFields> cluster
//     (CSRF_FORM_KEY === 'csrf') on BOTH the IdP-button form and the email form;
//   - the action-error message surfaces INLINE through <FormError> (role="alert") fed by
//     useAuthActionError — toast → inline. This assertion fails
//     against the earlier toast-only implementation, which rendered no inline alert.
import Signup from '@/routes/signup/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — passthrough it under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

// MaxMindTracker reaches for window/script side effects; stub to an inert node.
vi.mock('@/modules/fraud/maxmind-tracker', () => ({
  MaxMindTracker: () => null,
  readMaxMindTrackingToken: () => '',
}));

// useAuthActionError narrows actionData → resolves an i18n message → returns it for inline
// render. Stub it so we deterministically assert the route threads that message into the
// inline <FormError role="alert">, without driving a real form submit under happy-dom.
const mockAuthActionError = vi.fn<(d: unknown) => string | undefined>(() => undefined);
vi.mock('@/hooks/use-auth-action-error', () => ({
  useAuthActionError: (d: unknown) => mockAuthActionError(d),
}));

const BASE_VIEW = {
  showIdpButtons: true,
  allowEmailEntry: true,
  showEmailLink: false,
  showPasskey: false,
  showPassword: true,
  registrationDisabled: false,
};

const IDPS = [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }];

function loaderData(overrides?: Partial<Record<string, unknown>>) {
  return {
    csrfToken: 'csrf-token-xyz',
    branding: { logoUrl: '', themeMode: 'light' },
    view: BASE_VIEW,
    idps: IDPS,
    organization: 'acme',
    requestId: 'rq-123',
    maxmindAccountId: '',
    prefill: { email: '' },
    idp: undefined,
    ...overrides,
  };
}

function renderSignup(data: unknown, actionData?: unknown) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([
    {
      id: 'signup',
      path: '/signup',
      Component: () => <Signup />,
      loader: () => data,
      action: () => actionData ?? null,
    },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <ConformAdapter>
        <Stub initialEntries={['/signup']} />
      </ConformAdapter>
    </I18nProvider>
  );
}

describe('signup/index — render adoption', () => {
  it('emits the shared AuthFormFields csrf+identity cluster on the IdP button form', async () => {
    const { container } = renderSignup(loaderData());
    await screen.findByText('Google');
    // The first form is the IdP form: AuthFormFields(csrf,requestId,organization) + intent + idpId.
    const idpForm = container.querySelector('form');
    const hidden = Array.from(idpForm!.querySelectorAll('input[type="hidden"]')).map((i) => ({
      name: i.getAttribute('name'),
      value: i.getAttribute('value'),
    }));
    expect(hidden).toEqual([
      { name: 'csrf', value: 'csrf-token-xyz' },
      { name: 'requestId', value: 'rq-123' },
      { name: 'organization', value: 'acme' },
      { name: 'intent', value: 'idp' },
      { name: 'idpId', value: 'idp-g' },
    ]);
  });

  it('emits the shared AuthFormFields csrf cluster on the email form', async () => {
    const { container } = renderSignup(
      loaderData({ idps: [], view: { ...BASE_VIEW, showIdpButtons: false } })
    );
    // Reveal the email field (it is gated behind the "Email" button).
    fireEvent.click(await screen.findByText('Email'));
    const emailForm = container.querySelector('form');
    const hidden = Array.from(emailForm!.querySelectorAll('input[type="hidden"]')).map((i) =>
      i.getAttribute('name')
    );
    // AuthFormFields cluster (csrf → requestId → organization), then the ref'd deviceTrackingToken.
    expect(hidden).toEqual(['csrf', 'requestId', 'organization', 'deviceTrackingToken']);
  });

  it('threads the resolved action-error message INLINE as role="alert" (toast → inline)', async () => {
    mockAuthActionError.mockReturnValue('That email is invalid. Please try again.');
    renderSignup(loaderData({ idps: [], view: { ...BASE_VIEW, showIdpButtons: false } }), {
      error: 'INVALID_INPUT',
    });
    fireEvent.click(await screen.findByText('Email'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That email is invalid. Please try again.');
    expect(mockAuthActionError).toHaveBeenCalled();
    mockAuthActionError.mockReturnValue(undefined);
  });
});

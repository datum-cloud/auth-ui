// cypress/component/routes/login/login-recovery-render.cy.tsx
//
// Render port of app/routes/login/__tests__/login-recovery-render.test.tsx.
//
// Inline recovery affordance on OTP/MFA login routes that previously dead-ended on
// SESSION_EXPIRED with no recovery link. Uses the REAL useAuthActionRecovery pipeline —
// no react-router mock needed; createMemoryRouter + hydrationData supplies the context.
import LoginMfa from '@/routes/login/mfa';
import VerifyEmail from '@/routes/login/verify/email';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN_CONTEXT = { loginName: 'a@b.test', requestId: 'rq1', organization: 'acme' };

function withI18n(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountRecoveryRoute(
  Component: React.ComponentType,
  path: string,
  childId: string,
  loaderData: unknown,
  actionData: unknown
) {
  const router = createMemoryRouter(
    [
      {
        id: 'login',
        path: '/login',
        loader: () => LOGIN_CONTEXT,
        children: [
          {
            id: childId,
            path: path.replace('/login/', ''),
            element: <Component />,
          },
        ],
      },
    ],
    {
      initialEntries: [`/login/${path.replace('/login/', '')}`],
      hydrationData: {
        loaderData: { login: LOGIN_CONTEXT, [childId]: loaderData },
        actionData: { [childId]: actionData },
      },
    }
  );
  return mount(withI18n(<RouterProvider router={router} />));
}

// ── login/verify/email ────────────────────────────────────────────────────────

describe('login/verify/email — inline recovery', () => {
  const loaderData = { csrfToken: 'tok-1', code: '', next: undefined };

  it('renders a "Sign in again" recovery link preserving the ceremony on SESSION_EXPIRED', () => {
    mountRecoveryRoute(VerifyEmail, '/login/verify/email', 've', loaderData, {
      error: 'SESSION_EXPIRED',
    });
    cy.findByRole('link', { name: 'Sign in again' }).should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );
    cy.get('[role="alert"]').should('exist');
  });

  it('renders NO recovery link for a non-recoverable code (banner only)', () => {
    mountRecoveryRoute(VerifyEmail, '/login/verify/email', 've', loaderData, {
      error: 'INVALID_CREDENTIALS',
    });
    cy.get('[role="alert"]').should('exist');
    cy.findByRole('link', { name: 'Sign in again' }).should('not.exist');
  });
});

// ── login/mfa ─────────────────────────────────────────────────────────────────

describe('login/mfa — inline recovery', () => {
  const loaderData = { csrfToken: 'tok-1', secondFactors: ['otp_email'] };

  it('renders a "Sign in again" recovery link preserving the ceremony when SESSION_EXPIRED surfaces inline', () => {
    mountRecoveryRoute(LoginMfa, '/login/mfa', 'mfa', loaderData, { error: 'SESSION_EXPIRED' });
    cy.findByRole('link', { name: 'Sign in again' }).should(
      'have.attr',
      'href',
      '/login?requestId=rq1&organization=acme'
    );
  });

  it('renders NO recovery link for a non-recoverable code (banner only)', () => {
    mountRecoveryRoute(LoginMfa, '/login/mfa', 'mfa', loaderData, { error: 'INVALID_INPUT' });
    cy.get('[role="alert"]').should('exist');
    cy.findByRole('link', { name: 'Sign in again' }).should('not.exist');
  });
});

// cypress/component/routes/recover/recover-render.cy.tsx
//
// MOUNT: the three states /recover renders — the address form, the check-your-email terminal
// with the code field, and the ceremony — plus /recover/complete's expired card.
//
// The code field must render IDENTICALLY for every terminal state (§10): the terminal is what a
// real send, a suppressed send and a wrong code all produce, so a difference in the field itself
// would be the enumeration signal the action's byte-identical body already closed.
import { RecoveryCeremonyForm } from '@/components/recovery-ceremony/recovery-ceremony';
import Recover from '@/routes/recover/index';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { RouterProvider, createMemoryRouter } from 'react-router';

const loaderData = {
  csrfToken: 'csrf-1',
  branding: {},
  organization: 'org-1',
  requestId: 'req-1',
  recaptchaSiteKey: '',
  prefill: { email: '' },
};

function withProviders(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountRecover(actionData?: unknown, data: unknown = loaderData) {
  const router = createMemoryRouter([{ id: 'recover', path: '/recover', element: <Recover /> }], {
    initialEntries: ['/recover'],
    hydrationData: {
      loaderData: { recover: data },
      ...(actionData !== undefined ? { actionData: { recover: actionData } } : {}),
    },
  });
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('/recover — the address form', () => {
  it('asks for an email and posts intent=request', () => {
    mountRecover();
    cy.get('input[name="email"]').should('exist');
    cy.get('input[name="intent"]').should('have.value', 'request');
    cy.get('input[name="code"]').should('not.exist');
  });

  it('prefills the address an entry point handed across', () => {
    mountRecover(undefined, { ...loaderData, prefill: { email: 'owner@acme.test' } });
    cy.get('input[name="email"]').should('have.value', 'owner@acme.test');
  });
});

describe('/recover — the check-your-email terminal', () => {
  it('renders the code field and a start-over link, and posts intent=code', () => {
    mountRecover({ sent: true, email: 'owner@acme.test' });
    cy.contains('owner@acme.test').should('exist');
    cy.get('input[name="code"]')
      .should('have.attr', 'autocomplete', 'one-time-code')
      .and('have.attr', 'autocapitalize', 'none')
      .and('have.attr', 'autocorrect', 'off');
    cy.get('input[name="intent"]').should('have.value', 'code');
    cy.contains('Start over').should('exist');
  });

  it('renders the SAME code field after a wrong code, with the error above it', () => {
    mountRecover({ sent: true, email: 'owner@acme.test', error: 'INVALID_CODE' });
    // Same field, same attributes — only an added message. A state-dependent field would leak.
    cy.get('input[name="code"]')
      .should('have.attr', 'autocomplete', 'one-time-code')
      .and('have.attr', 'autocapitalize', 'none');
    cy.get('input[name="email"][type="hidden"]').should('have.value', 'owner@acme.test');
  });
});

describe('/recover — the ceremony', () => {
  it('swaps the form for the passkey ceremony once a code is accepted', () => {
    mountRecover({ ceremony: true, email: 'owner@acme.test', passkeyId: 'pk-1', publicKey: {} });
    cy.get('input[name="passkeyId"]').should('have.value', 'pk-1');
    cy.get('input[name="intent"]').should('have.value', 'verify');
    // Identity comes from the sealed ticket; the form must carry no account identifier.
    cy.get('input[name="userId"]').should('not.exist');
    cy.get('input[name="loginName"]').should('not.exist');
  });
});

describe('RecoveryCeremonyForm — a spent link', () => {
  it('replaces the whole form with a "request a new link" card on RECOVERY_EXPIRED', () => {
    const router = createMemoryRouter(
      [
        {
          id: 'c',
          path: '/recover/complete',
          element: (
            <RecoveryCeremonyForm
              csrfToken="csrf-1"
              publicKey={null}
              passkeyId=""
              requestId="req-1"
              organization="org-1"
              error="RECOVERY_EXPIRED"
            />
          ),
        },
        { id: 'r', path: '/recover', element: <div /> },
      ],
      { initialEntries: ['/recover/complete'] }
    );
    mount(withProviders(<RouterProvider router={router} />));
    cy.contains('expired').should('exist');
    cy.contains('Request a new link').should('exist');
    // A single-use code is terminal here — there must be nothing to retry on this screen.
    cy.get('input[name="credential"]').should('not.exist');
    cy.get('a[href*="/recover"]').should('exist');
  });
});

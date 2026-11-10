// cypress/component/routes/setup/setup-passkey-signup-back-link.cy.tsx
//
// /setup/passkey is reached from two places with opposite Back semantics:
//   • signup (returnTo=/signup/success) — the predecessor is the emailed verification
//     link, whose code is already spent, and previous-step.ts would send Back to
//     /setup/mfa (a second-factor chooser for an established account). No valid target.
//   • security settings (returnTo=/passkeys) — /setup/mfa IS the real predecessor.
// Pins that the route wires showBackLink from returnTo rather than always rendering it.
import SetupMfa from '@/routes/setup/mfa';
import SetupPasskey from '@/routes/setup/passkey';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

function withProviders(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

const IDENTITY = {
  csrfToken: 'tok-1',
  loginName: 'a@b.test',
  requestId: 'rq1',
  organization: 'acme',
  credentialId: 'pk1',
  publicKey: {},
  challengeFailed: false,
};

/** Mounts /setup/passkey with a real /setup/mfa sibling, so a rendered Back has a target. */
function mountPasskey(returnTo?: string, recoveryEnabled = false) {
  const router = createMemoryRouter(
    [
      { id: 'setup-passkey', path: '/setup/passkey', element: <SetupPasskey /> },
      { id: 'setup-mfa', path: '/setup/mfa', element: <SetupMfa /> },
    ],
    {
      initialEntries: ['/setup/passkey'],
      hydrationData: {
        loaderData: {
          'setup-passkey': {
            ...IDENTITY,
            force: 'false',
            checkAfter: 'false',
            returnTo,
            recoveryEnabled,
          },
        },
      },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

const SIGNUP_RETURN_TO = '/signup/success?loginName=a%40b.test&requestId=rq1';
const WARNING = /Please finish setting up your passkey before leaving this page/i;
const RECOVERABLE = /you can set it up later through account recovery/i;

// With self-serve recovery OFF (AUTH_ACCOUNT_RECOVERY_ENABLED unset), abandoning enrolment here
// strands the account: the email is already verified (that step enrolled otpEmail), so a retry
// returns ALREADY_EXISTS, while otpEmail is not a primary factor and cannot sign anyone in. The
// warning is the only thing standing between a closed tab and an unreachable account, so its
// presence is pinned rather than incidental.
describe('/setup/passkey — signup leg, recovery off: warns that leaving strands the account', () => {
  it('warns when returnTo points back into signup', () => {
    mountPasskey(SIGNUP_RETURN_TO);
    cy.contains(WARNING).should('be.visible');
    cy.contains(RECOVERABLE).should('not.exist');
  });

  // A security-settings enrolment is additive — that account already works, so the warning
  // would simply be untrue there.
  it('stays silent for a security-settings enrolment', () => {
    mountPasskey('/passkeys');
    cy.contains(WARNING).should('not.exist');
  });

  it('stays silent when no returnTo is threaded at all', () => {
    mountPasskey(undefined);
    cy.contains(WARNING).should('not.exist');
  });
});

// With recovery ON, /recover resumes an unfinished signup, so "your account won't be usable"
// is no longer true. The signup leg gets a calm note pointing at recovery instead.
describe('/setup/passkey — signup leg, recovery on: no lockout warning', () => {
  it('replaces the warning with a recovery note on the signup leg', () => {
    mountPasskey(SIGNUP_RETURN_TO, true);
    cy.contains(RECOVERABLE).should('be.visible');
    cy.contains(WARNING).should('not.exist');
    cy.contains("won't be usable").should('not.exist');
  });

  it('stays silent for a security-settings enrolment', () => {
    mountPasskey('/passkeys', true);
    cy.contains(RECOVERABLE).should('not.exist');
    cy.contains(WARNING).should('not.exist');
  });
});

describe('/setup/passkey — Back is suppressed on the signup leg', () => {
  it('renders no Back control when returnTo points back into signup', () => {
    mountPasskey('/signup/success?loginName=a%40b.test&requestId=rq1');
    cy.contains(/Set up passkey/i).should('exist');
    cy.contains('a', 'Back').should('not.exist');
  });

  it('keeps Back for a security-settings enrolment', () => {
    mountPasskey('/passkeys');
    cy.contains('a', 'Back').should('have.attr', 'href').and('include', '/setup/mfa');
  });

  it('keeps Back when no returnTo is threaded at all', () => {
    mountPasskey(undefined);
    cy.contains('a', 'Back').should('have.attr', 'href').and('include', '/setup/mfa');
  });
});

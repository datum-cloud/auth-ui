// WebAuthnButton onCredential: when the prop is set, the finished
// ceremony credential is handed to the parent INSTEAD of auto-submitting the form —
// the two-step enroll flow (ceremony → name step → submit) holds it in route state.
// Same createMemoryRouter recording harness as the other button specs; the Cypress
// pre-baked credential path exercises the same handoff the real ceremony runs.
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import React, { useRef } from 'react';
import { createMemoryRouter, RouterProvider, Form as RRForm } from 'react-router';

interface Recorded {
  fields?: Record<string, string>;
  credential?: Record<string, unknown>;
}

function Harness({ recorded }: { recorded: Recorded }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <RRForm ref={formRef} method="POST">
      <input type="hidden" name="credential" defaultValue="" />
      <WebAuthnButton
        publicKey={null}
        formRef={formRef}
        mode="attestation"
        onCredential={(credential) => {
          recorded.credential = credential;
        }}
      />
    </RRForm>
  );
}

function mountHarness(recorded: Recorded) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <I18nProvider i18n={i18n}>
            <Harness recorded={recorded} />
          </I18nProvider>
        ),
        action: async ({ request }) => {
          const form = await request.formData();
          recorded.fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
          return null;
        },
      },
    ],
    { initialEntries: ['/'] }
  );
  return mount(<RouterProvider router={router} />);
}

describe('WebAuthnButton onCredential (two-step enroll handoff)', () => {
  it('hands the credential to the parent and does NOT submit the form', () => {
    const recorded: Recorded = {};
    mountHarness(recorded);
    cy.findByRole('button').should('not.be.disabled').click();
    cy.wrap(recorded).should((r) => {
      expect(r.credential, 'parent received the credential').to.have.property(
        'id',
        'fake-credential-id'
      );
      expect(r.fields, 'form was not auto-submitted').to.equal(undefined);
    });
  });
});

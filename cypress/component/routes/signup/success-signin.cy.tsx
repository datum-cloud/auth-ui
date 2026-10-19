// cypress/component/routes/signup/success-signin.cy.tsx
//
// The signup terminal signs the new user in with their passkey, against a stubbed /login/passkey.
import SignupSuccess from '@/routes/signup/success';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const LOGIN = 'new@acme.test';

const capturedPosts: Array<Record<string, unknown>> = [];
const challengeLoads: string[] = [];

function mountSuccess(opts?: { challenge?: unknown; requestId?: string }) {
  const successData = { loginName: LOGIN, requestId: opts?.requestId, organization: undefined };
  const router = createMemoryRouter(
    [
      {
        id: 'success',
        path: '/signup/success',
        element: <SignupSuccess />,
        loader: async () => successData,
      },
      {
        id: 'passkey',
        path: '/login/passkey',
        loader: async ({ request }: { request: Request }) => {
          challengeLoads.push(new URL(request.url).search);
          return {
            csrfToken: 'tok-1',
            loginName: LOGIN,
            requestId: opts?.requestId,
            organization: undefined,
            publicKeyCredentialRequestOptions:
              opts && 'challenge' in opts ? opts.challenge : { publicKey: { challenge: 'x' } },
          };
        },
        action: async ({ request }: { request: Request }) => {
          capturedPosts.push(Object.fromEntries(await request.formData()));
          return {};
        },
      },
    ],
    {
      initialEntries: [`/signup/success?loginName=${encodeURIComponent(LOGIN)}`],
      hydrationData: { loaderData: { success: successData } },
    }
  );
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return mount(
    <I18nProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}

describe('/signup/success — signs the new user in with their passkey', () => {
  beforeEach(() => {
    capturedPosts.length = 0;
    challengeLoads.length = 0;
  });

  it('starts the passkey sign-in on arrival and posts the assertion for this account', () => {
    mountSuccess();
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(1);
    });
    cy.wrap(null).then(() => {
      expect(capturedPosts[0].loginName).to.equal(LOGIN);
      expect(capturedPosts[0].credential).to.be.a('string');
    });
  });

  it('threads the ceremony requestId so sign-in resumes the OIDC request', () => {
    mountSuccess({ requestId: 'oidc_req1' });
    cy.wrap(null).should(() => {
      expect(capturedPosts).to.have.length(1);
    });
    cy.wrap(null).then(() => {
      expect(capturedPosts[0].requestId).to.equal('oidc_req1');
      expect(challengeLoads[0]).to.include('requestId=oidc_req1');
    });
  });

  it('stays silent when the AUTO attempt fails and leaves the button as the way forward', () => {
    mountSuccess({ challenge: null });
    cy.wrap(null).should(() => {
      expect(challengeLoads).to.have.length(1);
    });
    cy.contains('The passkey verification failed').should('not.exist');
    cy.contains('a', /sign in with your passkey/i).should('be.visible');
  });

  it('reports the failure once the user starts the sign-in themselves', () => {
    mountSuccess({ challenge: null });
    cy.wrap(null).should(() => {
      expect(challengeLoads).to.have.length(1);
    });
    cy.contains('a', /sign in with your passkey/i).click();
    cy.contains('The passkey verification failed').should('be.visible');
  });
});

import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import type { IdProvider } from '@/modules/auth/types';
import { MAXMIND_TOKEN_STORAGE_KEY } from '@/modules/fraud/maxmind-tracker';

const google: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };

function mountList() {
  // react-router's <Form> (used by IdpButtonList) requires a DATA router context
  // (useSubmit/useDataRouterContext) — plain cy.mount's MemoryRouter isn't enough.
  cy.mountRemixRoute(<IdpButtonList idps={[google]} csrf="csrf-tok" submittingIdpId={null} />);
}

describe('IdpButtonList — MaxMind device-tracking token threading', () => {
  beforeEach(() => {
    cy.window().then((win) => win.sessionStorage.clear());
  });

  it('includes a deviceTrackingToken hidden field carrying the mirrored MaxMind token when one is present', () => {
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'mm-button-token-1');
    });
    mountList();
    cy.get('input[name="deviceTrackingToken"]').should('have.value', 'mm-button-token-1');
  });

  it('omits the deviceTrackingToken field entirely when no token has been captured', () => {
    mountList();
    cy.get('input[name="idpId"]').should('exist'); // sanity: the form rendered
    cy.get('input[name="deviceTrackingToken"]').should('not.exist');
  });
});

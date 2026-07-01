// cypress/component/modules/fraud/maxmind-tracker.cy.tsx
//
// Component port of app/modules/fraud/__tests__/maxmind-tracker.test.tsx.
// MaxMindTracker only imports React + touches document/sessionStorage → browser-safe. The device.js
// <script> injection and the sessionStorage token mirror run for real in the Cypress browser.
import {
  MaxMindTracker,
  MAXMIND_TOKEN_STORAGE_KEY,
  readMaxMindTrackingToken,
} from '@/modules/fraud/maxmind-tracker';

afterEach(() => {
  document.querySelectorAll('script[data-maxmind="device"]').forEach((s) => s.remove());
  window.sessionStorage.clear();
});

describe('MaxMindTracker', () => {
  it('renders nothing and appends no script when accountId is empty; appends the device.js script exactly once when accountId is set', () => {
    cy.mount(<MaxMindTracker accountId="" />);
    cy.document().then((doc) => {
      expect(doc.querySelectorAll('script[data-maxmind="device"]')).to.have.length(0);
    });

    cy.mount(<MaxMindTracker accountId="123456" />);
    cy.get('script[data-maxmind="device"]')
      .should('have.length', 1)
      .and('have.attr', 'src', 'https://device.maxmind.com/js/device.js');
  });
});

describe('readMaxMindTrackingToken', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('returns undefined when no token has been mirrored, and returns the token previously written to sessionStorage', () => {
    expect(readMaxMindTrackingToken()).to.be.undefined;
    window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-xyz');
    expect(readMaxMindTrackingToken()).to.equal('tok-xyz');
  });
});

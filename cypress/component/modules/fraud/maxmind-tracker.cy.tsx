// cypress/component/modules/fraud/maxmind-tracker.cy.tsx
//
// Component port of app/modules/fraud/__tests__/maxmind-tracker.test.tsx.
// MaxMindTracker only imports React + touches document/sessionStorage → browser-safe. The device.js
// <script> injection and the sessionStorage token mirror run for real in the Cypress browser.
import {
  MaxMindTracker,
  MAXMIND_TOKEN_STORAGE_KEY,
  readMaxMindTrackingToken,
  syncMaxMindTokenToRef,
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

// RED→GREEN (fast-signup race fix): the periodic mirror-sync interval on each signup screen
// only copies sessionStorage → the hidden input on a timer, so a fast submit can beat it and
// send an empty deviceTrackingToken even though a token WAS captured. syncMaxMindTokenToRef is
// the submit-time (button onClick) read that closes that race — these pin its behavior in
// isolation, independent of any router/form harness.
describe('syncMaxMindTokenToRef', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('syncs a captured token into the ref, leaves it untouched when absent, tolerates a null ref', () => {
    for (const [stored, initial, expected] of [
      // Nothing mirrored into sessionStorage yet when the ref is created (mirrors the real
      // scenario: the periodic interval hasn't ticked, or device.js hasn't captured the
      // cookie at mount time) — then the token lands and the user submits immediately after.
      ['tok-submit-time', '', 'tok-submit-time'],
      // No token captured at all — the server-round-tripped value must survive untouched.
      [undefined, 'server-round-tripped-value', 'server-round-tripped-value'],
    ] as const) {
      window.sessionStorage.clear();
      if (stored) window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, stored);
      const input = document.createElement('input');
      input.value = initial;

      syncMaxMindTokenToRef({ current: input });

      expect(input.value, `stored=${String(stored)}`).to.equal(expected);
    }

    // A null ref must not throw even when a token IS available to write.
    window.sessionStorage.clear();
    window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-ignored');
    expect(() => syncMaxMindTokenToRef({ current: null })).to.not.throw();
  });
});

// cypress/component/routes/recover/recover-complete-fragment.cy.tsx
//
// MOUNT: /recover/complete's landing, whose job is to get the registration code out of the URL
// FRAGMENT and into the POST without the code ever having been sent to a server.
//
// WHY THE FRAGMENT (contract v2, zitadel-provider #138). The mail link is
// `…/recover/complete?userId&codeId#code=<code>`. A fragment is never put on the wire: it is not
// in the request line, so it cannot reach an access log, a proxy, an APM trace or a Referer
// header. That is the whole reason the code moved out of the query, and it is why this page reads
// it client-side only — the loader never sees it and must never need it.
//
// THE TYPED FIELD IS THE FALLBACK, AND IT IS WHAT SSR RENDERS. The server cannot know whether a
// fragment is present, so the no-JS/no-fragment form is what ships in the HTML and the effect
// swaps in a hidden input once it finds a code. Rendering the hidden input first would leave a
// JS-off user with a form that posts an empty code and no way to type one.
import RecoverComplete from '@/routes/recover/complete';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { mount } from 'cypress/react';
import { RouterProvider, createMemoryRouter } from 'react-router';

const loaderData = {
  csrfToken: 'csrf-1',
  userId: 'u-1',
  codeId: 'code-id-1',
  requestId: 'req-1',
  organization: 'org-1',
};

function withProviders(node: React.ReactNode) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return (
    <I18nProvider i18n={i18n}>
      <ConformAdapter>{node}</ConformAdapter>
    </I18nProvider>
  );
}

function mountComplete(data: unknown = loaderData) {
  const router = createMemoryRouter(
    [{ id: 'complete', path: '/recover/complete', element: <RecoverComplete /> }],
    { initialEntries: ['/recover/complete'], hydrationData: { loaderData: { complete: data } } }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

// The component reads the REAL window.location.hash, so each test sets it on the AUT window and
// clears it afterwards — a leftover fragment would make the next test pass for the wrong reason.
function setHash(hash: string) {
  window.location.hash = hash;
}

afterEach(() => {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
});

describe('/recover/complete — the code arrives in the fragment', () => {
  it('carries it into a hidden input on the start form', () => {
    setHash('#code=ABC123XY');
    mountComplete();

    cy.get('input[name="code"]')
      .should('have.attr', 'type', 'hidden')
      .and('have.value', 'ABC123XY');
    // The rest of the start POST is unchanged — these still come from the query string.
    cy.get('input[name="intent"]').should('have.value', 'start');
    cy.get('input[name="userId"]').should('have.value', 'u-1');
    cy.get('input[name="codeId"]').should('have.value', 'code-id-1');
    cy.get('input[name="csrf"]').should('have.value', 'csrf-1');
    // With a code in hand there is nothing to type, and nothing to explain.
    cy.get('label[for="code"]').should('not.exist');
    cy.contains('Enter the code from that email').should('not.exist');
  });

  it('URL-decodes the fragment value', () => {
    setHash(`#code=${encodeURIComponent('a b+c/d=')}`);
    mountComplete();
    cy.get('input[name="code"][type="hidden"]').should('have.value', 'a b+c/d=');
  });

  it('reads `code` even when the fragment carries other parameters', () => {
    setHash('#state=xyz&code=ABC123XY');
    mountComplete();
    cy.get('input[name="code"][type="hidden"]').should('have.value', 'ABC123XY');
  });

  it('strips the fragment from the address bar once it has been read', () => {
    setHash('#code=ABC123XY');
    mountComplete();
    // The value is in the form, and the credential is out of the URL — so it is not in the
    // history entry, not in anything the user copies out of the address bar, and not in a
    // screenshot or a screen-share of this page.
    cy.get('input[name="code"][type="hidden"]').should('have.value', 'ABC123XY');
    cy.window().its('location.hash').should('equal', '');
  });
});

describe('/recover/complete — no fragment', () => {
  it('renders the typed-code field so the user can key in the code from the mail', () => {
    mountComplete();
    cy.get('input[name="code"]')
      .should('not.have.attr', 'type', 'hidden')
      .and('have.attr', 'autocomplete', 'one-time-code')
      .and('have.attr', 'autocapitalize', 'none')
      .and('have.attr', 'autocorrect', 'off');
    cy.get('label[for="code"]').should('exist');
    // An unexplained secret field is not a usable fallback — the reader has to be told the mail
    // already carries the code.
    cy.contains('Enter the code from that email').should('exist');
    // Still the same POST — only where the code comes from changed.
    cy.get('input[name="intent"]').should('have.value', 'start');
    cy.get('input[name="userId"]').should('have.value', 'u-1');
  });

  it('renders the typed field for a fragment that names no code', () => {
    setHash('#state=xyz');
    mountComplete();
    cy.get('input[name="code"]').should('not.have.attr', 'type', 'hidden');
  });
});

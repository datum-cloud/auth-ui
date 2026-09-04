// cypress/component/routes/signup/signup-render.cy.tsx
//
// Render port of app/routes/signup/__tests__/signup-render.test.tsx.
// Pins shared-primitive adoption on the signup identifier screen:
//   - AuthFormFields csrf+identity cluster on both the IdP form and the email form
//   - Structural form shape (hidden inputs, field names)
//
// The useAuthActionError inline-alert test requires vi.mock and is not ported here;
// the inline error path is covered by the integration action tests in signup-track.cy.ts.
import { MAXMIND_TOKEN_STORAGE_KEY } from '@/modules/fraud/maxmind-tracker';
import Signup from '@/routes/signup/index';
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

const BASE_VIEW = {
  showIdpButtons: true,
  allowEmailEntry: true,
  showEmailLink: false,
  showPasskey: false,
  showPassword: true,
  signupUnavailable: false,
};

const IDPS = [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }];

function loaderData(overrides: Record<string, unknown> = {}) {
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

function mountSignup(data: unknown, onSubmitFormData?: (form: FormData) => void) {
  const router = createMemoryRouter(
    [
      {
        id: 'signup',
        path: '/signup',
        element: <Signup />,
        // Captures the REAL submitted FormData so the MaxMind sync test below can assert on
        // what actually went out on the wire, not on post-navigation DOM state — React Router
        // treats a `<Form method="post">` submission as a real client-side navigation, which
        // re-renders (and can recreate) the route's DOM afterward, so asserting on the input's
        // value AFTER the click is asserting the wrong thing. A matching `loader` re-returning
        // the same data keeps the route's post-submit revalidation from crashing (no loader ⇒
        // useLoaderData() is undefined ⇒ the destructure in Signup() throws).
        action: async ({ request }) => {
          onSubmitFormData?.(await request.formData());
          return null;
        },
        loader: () => data,
      },
    ],
    {
      initialEntries: ['/signup'],
      hydrationData: { loaderData: { signup: data } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

describe('signup/index — render adoption', () => {
  it('emits csrf + requestId + organization on the IdP form, and hides Email entry when disabled', () => {
    mountSignup(loaderData());
    cy.contains('Google', { timeout: 6000 }).should('exist');
    // The first form is the IdP form; it must carry csrf, requestId, organization.
    cy.get('form')
      .first()
      .within(() => {
        cy.get('input[type="hidden"][name="csrf"]').should('have.value', 'csrf-token-xyz');
        cy.get('input[type="hidden"][name="requestId"]').should('have.value', 'rq-123');
        cy.get('input[type="hidden"][name="organization"]').should('have.value', 'acme');
      });

    // view.allowEmailEntry=false when delivery is off — the Email button must not appear.
    mountSignup(
      loaderData({
        view: {
          ...BASE_VIEW,
          allowEmailEntry: false,
          showEmailLink: false,
        },
      })
    );
    cy.contains('Google', { timeout: 6000 }).should('exist');
    cy.contains('Email').should('not.exist');
  });

  it('shows unavailable message and no blank content when delivery off + no IdPs (signupUnavailable=true)', () => {
    // RED→GREEN: before the fix this rendered a blank content area (no IdP buttons,
    // no Email button, no message). signupUnavailable=true must surface the message.
    mountSignup(
      loaderData({
        view: {
          ...BASE_VIEW,
          showIdpButtons: false,
          allowEmailEntry: false,
          showEmailLink: false,
          signupUnavailable: true,
        },
        idps: [],
      })
    );
    cy.contains('Registration is currently unavailable', { timeout: 6000 }).should('exist');
    cy.contains('Email').should('not.exist');
    cy.contains('Google').should('not.exist');
  });
});

// RED→GREEN (fast-signup race fix): the deviceTrackingToken FIELD SUBMITTED ON THE WIRE must
// carry whatever token is in sessionStorage AT SUBMIT TIME, not just whatever the periodic
// 300ms sync interval last wrote. Seeding sessionStorage AFTER mount (simulating the token
// landing after the component rendered) and clicking Continue immediately proves the
// click-time read, not the interval, is what puts the token in the request — asserted on the
// REAL submitted FormData (not the post-navigation DOM, which React Router re-renders/can
// recreate once the submission completes, making it the wrong thing to assert on).
describe('signup/index — MaxMind deviceTrackingToken submit-time sync', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('submits the freshest sessionStorage token even though the periodic sync interval never ticked', () => {
    const submitted: FormData[] = [];
    mountSignup(loaderData(), (form) => submitted.push(form));
    cy.contains('button', 'Email', { timeout: 6000 }).click();
    cy.get('input[name="email"]').type('racer@example.com');
    // Seed the token AFTER the form is already showing — the periodic sync interval may not
    // have ticked yet (it runs every 300ms); the click-time read must still pick it up.
    cy.window().then((win) => {
      win.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-fast-signup');
    });
    cy.get('input[name="deviceTrackingToken"]').should('have.value', '');
    cy.contains('button', 'Continue').click();
    // The action's FormData capture runs inside React Router's async submission handling —
    // poll (the array is the same mutable reference `mountSignup`'s action pushes into) rather
    // than asserting immediately after .click().
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('deviceTrackingToken')).to.equal('tok-fast-signup');
    });
  });
});

// Mounts the route with actionData already hydrated (post-register 'sent' terminal, or an
// inline error) instead of loader data alone — createMemoryRouter's hydrationData accepts both
// per route id, and the 'sent' branch in Signup() is reached by actionData, not loader state.
// Follows the createMemoryRouter + hydrationData pattern in method-render.cy.tsx.
function mountWithActionData(actionData: unknown, onSubmitFormData?: (form: FormData) => void) {
  const data = loaderData();
  const router = createMemoryRouter(
    [
      {
        id: 'signup',
        path: '/signup',
        element: <Signup />,
        // Same FormData capture as mountSignup above: what actually left the client is the only
        // thing worth asserting about client-side validation, since a blocked submission simply
        // never reaches the action.
        action: async ({ request }) => {
          onSubmitFormData?.(await request.formData());
          return actionData;
        },
        loader: () => data,
      },
    ],
    {
      initialEntries: ['/signup'],
      hydrationData: { loaderData: { signup: data }, actionData: { signup: actionData } },
    }
  );
  return mount(withProviders(<RouterProvider router={router} />));
}

// The code field is part of the enumeration-safe terminal, so it renders for EVERY account state.
// A field that appeared only for real accounts would be an existence oracle.
describe('signup/index — check-your-email terminal', () => {
  it('offers a code field alongside the link, and warns which device the link uses', () => {
    mountWithActionData({ sent: true, email: 'someone@acme.test' });
    cy.contains(/check your email/i);
    cy.contains(/open it on this device/i).should('be.visible');
    cy.get('input[name="code"]').should('exist');
    cy.get('input[name="intent"][value="code"]').should('exist');
    // The code's format is Zitadel configuration this codebase does not own, so a client-side
    // shape rule would reject valid codes the day that config changes. This must hold even
    // though the client schema declares code as required: a datum-ui upgrade that starts
    // spreading fieldState.inputProps (which carries minLength from getZodConstraint) onto the
    // rendered <input> would silently reintroduce exactly this — nothing else would catch it.
    // Separate cy.get() calls per attribute: chai-jquery's `attr` assertion reassigns the
    // chained subject to the (here, undefined) attribute value, so `.and('not.have.attr', …)`
    // off a passing `not.have.attr` fails with "assertion on undefined" rather than passing.
    cy.get('input[name="code"]').should('not.have.attr', 'minlength');
    cy.get('input[name="code"]').should('not.have.attr', 'maxlength');
    cy.get('input[name="code"]').should('not.have.attr', 'pattern');
  });

  it('never puts a userId in the page', () => {
    mountWithActionData({ sent: true, email: 'someone@acme.test' });
    cy.get('input[name="userId"]').should('not.exist');
  });

  // The code's case is the server's business (signupCodeSchema keeps no shape rule at all), but a
  // bare text input is autocapitalised and autocorrected by every touch keyboard — so the client
  // would mangle the case anyway, on exactly the devices this feature exists for (start on the
  // laptop, read the mail on the phone).
  it('turns off the keyboard transforms that would rewrite the code on a phone', () => {
    mountWithActionData({ sent: true, email: 'someone@acme.test' });
    cy.get('input[name="code"]').should('have.attr', 'autocapitalize', 'none');
    cy.get('input[name="code"]').should('have.attr', 'autocorrect', 'off');
    cy.get('input[name="code"]').should('have.attr', 'spellcheck', 'false');
  });

  // REGRESSION GUARD (the feature was single-shot): a rejected code returns the terminal shape
  // PLUS `error`, so the user lands back on this screen with the address still filled and the
  // message inline in the code form. The previous `{ error }`-only rejection failed the
  // `'sent' in actionData` branch test, dropping the user onto the empty "Get started" screen —
  // and the <FormError> inside the code form could never receive a message at all.
  it('keeps the terminal, the address and a retryable code field when the code is rejected', () => {
    mountWithActionData({ sent: true, email: 'someone@acme.test', error: 'INVALID_CODE' });
    cy.contains(/check your email/i).should('exist');
    // Still the terminal, not the identifier screen.
    cy.contains(/get started/i).should('not.exist');
    cy.get('input[name="code"]').should('exist');
    cy.get('input[name="email"]').should('have.value', 'someone@acme.test');
    // The message renders INSIDE the code form, next to the field that produced it.
    cy.get('form')
      .filter(':has(input[name="code"])')
      .within(() => {
        cy.contains(/that code is invalid or has expired/i).should('exist');
      });
  });
});

// The three attribute assertions above (no minlength/maxlength/pattern) only cover ONE of the two
// ways this client can start rejecting codes. The datum-ui conform adapter also wires
// `onValidate: ({ formData }) => parseWithZod(formData, { schema })`, so the zod schema itself runs
// in the browser and BLOCKS submission — and the terminal's client schema is a pick() of the
// SERVER schema. Adding `.length(6)` or a `.regex(...)` to signupCodeSchema for server-side defence
// would therefore create a client-side blocking rule instantly, with all three attribute
// assertions still passing. Only "did the submission actually leave the client" survives both.
describe('signup/index — the code field validates no shape client-side', () => {
  it('submits a deliberately off-shape code instead of blocking it', () => {
    const submitted: FormData[] = [];
    mountWithActionData({ sent: true, email: 'someone@acme.test' }, (form) => submitted.push(form));
    // Lowercase and far too short for the `78PEKH` shape the mail actually sends: the client must
    // have no opinion about either.
    cy.get('input[name="code"]').type('ab');
    cy.contains('button', 'Continue').click();
    cy.wrap(submitted, { timeout: 6000 }).should('have.length', 1);
    cy.then(() => {
      expect(submitted[0].get('intent')).to.equal('code');
      expect(submitted[0].get('code'), 'sent verbatim, unaltered').to.equal('ab');
    });
  });
});

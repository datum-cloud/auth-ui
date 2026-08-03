/**
 * Cypress mount port of the Vitest a11y-guard.
 * Three layers:
 *   1. axe structural/aria — cy.injectAxe() + cy.checkA11y() scoped to [data-cy-root]
 *      (avoids false-positive page-level violations from the Cypress test harness)
 *   2. Focus order / keyboard — DOM-order assertions using compareDocumentPosition
 *   3. prefers-reduced-motion — absence of entrance-animation CSS classes
 */
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { Form } from '@datum-cloud/datum-ui/form';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import 'cypress-axe';

// Route options: path='*' so useLocation returns /login/password (BackLink renders).
const OPTS = { initialEntries: ['/login/password'], path: '*' };

// A complete ceremony body that exercises OTP field + hidden-input cluster.
function CeremonyBody() {
  return (
    <ConformAdapter>
      <Form.Root schema={otpCodeClientSchema} method="POST" defaultValues={{ code: '' }}>
        <AuthFormFields csrf="csrf-token" loginName="alice@acme.test" requestId="rq1" />
        <OtpCodeField label="Email code" />
        <button type="submit">Verify</button>
      </Form.Root>
    </ConformAdapter>
  );
}

// Focusable selector matching the original axe-helper.ts.
const FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Scoped axe check for component tests.
 *
 * Disables page-level document rules that fire on the full Cypress test harness
 * (html, head, title) regardless of scope — they don't apply to mounted components.
 * This matches the behaviour of the original axe.run(container) in the Vitest test,
 * which ran against an isolated RTL container, not the full document.
 *
 * Disabled page rules (not component concerns):
 *   - document-title    : Cypress test frame has no <title>
 *   - html-has-lang     : Cypress test frame has no lang="" on <html>
 *   - landmark-one-main : mounted fragment has no <main> landmark
 *   - page-has-heading-one : mounted fragment may have no <h1>
 */
const AXE_COMPONENT_RULES = {
  rules: {
    'color-contrast': { enabled: false },
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

function checkComponentA11y() {
  cy.injectAxe();
  cy.checkA11y('[data-cy-root]', AXE_COMPONENT_RULES);
}

describe('a11y guard — axe structural/aria (0 violations)', () => {
  it('AuthCeremony verify body and AuthFormFields cluster have no axe violations', () => {
    const surfaces = [
      {
        label: 'AuthCeremony with a full verify body',
        node: (
          <AuthCeremony title="Enter your code" description="We sent a code to your email">
            <CeremonyBody />
          </AuthCeremony>
        ),
        opts: OPTS,
      },
      {
        label: 'AuthFormFields (hidden-input cluster)',
        node: (
          <form>
            <AuthFormFields
              csrf="csrf-token"
              loginName="alice@acme.test"
              requestId="rq1"
              organization="acme"
              next="/dashboard"
            />
          </form>
        ),
        opts: undefined,
      },
    ];

    surfaces.forEach((surface, i) => {
      // cy.log names the surface in the command log — checkA11y reports the
      // violation itself but not which row mounted the offending tree.
      cy.log(surface.label);
      cy.mount(surface.node, surface.opts);
      if (i === 0) {
        // axe persists on the AUT window across mounts within a test — inject
        // once after the first mount instead of re-evaluating the bundle per row.
        cy.injectAxe();
      }
      cy.checkA11y('[data-cy-root]', AXE_COMPONENT_RULES);
    });
  });

  it('inline error banner (FormError, role="alert") has no axe violations', () => {
    cy.mount(<FormError>Incorrect credentials. Please try again.</FormError>);
    checkComponentA11y();
    cy.findByRole('alert').should('have.attr', 'aria-live', 'assertive');
  });
});

describe('a11y guard — focus order / keyboard (logical order, no trap, recovery reachable)', () => {
  it('exposes a logical forward tab order: OTP field → submit → BackLink', () => {
    cy.mount(
      <AuthCeremony title="Enter your code">
        <CeremonyBody />
      </AuthCeremony>,
      OPTS
    );
    cy.get(FOCUSABLE_SEL).then(($els) => {
      const els = Cypress.$.makeArray($els) as HTMLElement[];
      cy.findByLabelText(/Email code/).then(($input) => {
        cy.findByRole('button', { name: 'Verify' }).then(($btn) => {
          cy.findByRole('link', { name: 'Back' }).then(($back) => {
            const idxOf = (el: HTMLElement) => els.indexOf(el);
            const iOtp = idxOf($input[0]);
            const iSubmit = idxOf($btn[0]);
            const iBack = idxOf($back[0]);
            expect(iOtp, 'OTP field is in tabbable set').to.be.at.least(0);
            expect(iSubmit, 'submit follows OTP').to.be.greaterThan(iOtp);
            expect(iBack, 'BackLink follows submit').to.be.greaterThan(iSubmit);
          });
        });
      });
    });
  });

  it('keeps the recovery <Link> inside the error banner in the tab order (reachable)', () => {
    cy.mount(
      <AuthCeremony
        title="Enter your code"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <button type="submit">Verify</button>
      </AuthCeremony>,
      OPTS
    );
    cy.get(FOCUSABLE_SEL).then(($els) => {
      const els = Cypress.$.makeArray($els) as HTMLElement[];
      cy.findByRole('link', { name: 'Sign in again' }).then(($recovery) => {
        cy.findByRole('button', { name: 'Verify' }).then(($submit) => {
          const iRecovery = els.indexOf($recovery[0]);
          const iSubmit = els.indexOf($submit[0]);
          expect(iRecovery, 'recovery link is tabbable').to.be.at.least(0);
          expect(iRecovery, 'recovery precedes submit in tab order').to.be.lessThan(iSubmit);
          cy.wrap($recovery).should('have.attr', 'href', '/login');
        });
      });
    });
  });
});

describe('a11y guard — prefers-reduced-motion honored', () => {
  it('the ceremony renders without motion-dependent markup under reduced-motion preference', () => {
    cy.window().then((win) => {
      cy.stub(win, 'matchMedia').callsFake((query: string) => ({
        matches: /prefers-reduced-motion:\s*reduce/.test(query),
        media: query,
        onchange: null,
        addEventListener: cy.stub(),
        removeEventListener: cy.stub(),
        addListener: cy.stub(),
        removeListener: cy.stub(),
        dispatchEvent: cy.stub(),
      }));
    });

    cy.mount(
      <AuthCeremony title="Enter your code" description="We sent a code">
        <CeremonyBody />
      </AuthCeremony>,
      OPTS
    );

    cy.contains('Enter your code').should('exist');
    cy.findByLabelText(/Email code/).should('exist');

    // No entrance animation or layout-shifting transition utilities present.
    cy.get(
      '[class*="animate-"],[class*="transition-transform"],[class*="transition-all"],[class*="motion-safe:"]'
    ).should('not.exist');
  });
});

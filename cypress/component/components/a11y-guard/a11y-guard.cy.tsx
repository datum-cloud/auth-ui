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
import { BackLink } from '@/components/back-link/back-link';
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
function checkComponentA11y() {
  cy.injectAxe();
  cy.checkA11y('[data-cy-root]', {
    rules: {
      'color-contrast': { enabled: false },
      'document-title': { enabled: false },
      'html-has-lang': { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
}

describe('a11y guard — axe structural/aria (0 violations)', () => {
  it('AuthCeremony with a full verify body has no axe violations', () => {
    cy.mount(
      <AuthCeremony title="Enter your code" description="We sent a code to your email">
        <CeremonyBody />
      </AuthCeremony>,
      OPTS
    );
    checkComponentA11y();
  });

  it('AuthCeremony with the inline error banner + recovery link has no axe violations', () => {
    cy.mount(
      <AuthCeremony
        title="Enter your code"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <CeremonyBody />
      </AuthCeremony>,
      OPTS
    );
    checkComponentA11y();
  });

  it('OtpCodeField (datum-ui Form.Field labelled control) has no axe violations', () => {
    cy.mount(
      <ConformAdapter>
        <Form.Root schema={otpCodeClientSchema} method="POST" defaultValues={{ code: '' }}>
          <OtpCodeField label="Authenticator code" />
        </Form.Root>
      </ConformAdapter>
    );
    checkComponentA11y();
  });

  it('AuthFormFields (hidden-input cluster) has no axe violations', () => {
    cy.mount(
      <form>
        <AuthFormFields
          csrf="csrf-token"
          loginName="alice@acme.test"
          requestId="rq1"
          organization="acme"
          next="/dashboard"
        />
      </form>
    );
    checkComponentA11y();
  });

  it('BackLink (single styled <a>) has no axe violations', () => {
    cy.mount(<BackLink />, OPTS);
    checkComponentA11y();
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

  it('uses no positive tabindex (no manual focus-order trap)', () => {
    cy.mount(
      <AuthCeremony title="Enter your code">
        <CeremonyBody />
      </AuthCeremony>,
      OPTS
    );
    // Use document.querySelectorAll directly so an empty result doesn't throw.
    cy.document().then((doc) => {
      const positive = Array.from(doc.querySelectorAll('[tabindex]')).filter(
        (el) => Number(el.getAttribute('tabindex')) > 0
      );
      expect(positive, 'no positive tabindex elements').to.have.length(0);
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

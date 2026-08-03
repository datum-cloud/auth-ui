import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { Form } from '@datum-cloud/datum-ui/form';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';

// cy.mount wraps in MemoryRouter + I18nProvider; set path:'*' so useLocation returns
// whatever initialEntries[0] is (BackLink needs the pathname to resolve its predecessor).
const OPTS = { initialEntries: ['/login/password'], path: '*' };

describe('AuthCeremony shell', () => {
  it('renders title, description, and children; renders a recovery <Link> when recovery is set', () => {
    cy.mount(
      <AuthCeremony title="Enter your code" description="We sent it to you">
        <p>child-body</p>
      </AuthCeremony>,
      OPTS
    );
    cy.contains('Enter your code').should('exist');
    cy.contains('We sent it to you').should('exist');
    cy.contains('child-body').should('exist');

    cy.mount(
      <AuthCeremony
        title="t"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.findByRole('link', { name: 'Sign in again' })
      .should('exist')
      .and('have.attr', 'href', '/login');
  });
});

describe('AuthCeremony shell — identity centering + showBackLink suppression', () => {
  it('renders no Back control when showBackLink={false}, and centers the IdentityBadge row', () => {
    // OPTS mounts at /login/password, which DOES have a predecessor in previous-step.ts
    // (-> /login) — proving suppression here (not just at a dead-link path) is what makes
    // Tasks 3 and 5's showBackLink={false} route changes meaningfully tested: this test
    // proves the mechanism; those tasks prove the specific routes wire it through.
    //
    // Asserted FIRST on purpose: `cy.get('a').should('not.exist')` is a whole-DOM negative,
    // so it is only meaningful on a clean mount — it must not run after a sibling mount in
    // this test has rendered links of its own.
    cy.mount(
      <AuthCeremony title="t" showBackLink={false}>
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.get('a').should('not.exist');

    cy.mount(
      <AuthCeremony title="t" loginName="alice@acme.test">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.get('[data-testid="auth-ceremony-body"]')
      .should('have.class', 'items-center')
      .and('not.have.class', 'items-baseline');
  });
});

describe('OtpCodeField', () => {
  function mountOtpField(label = 'Email code', name = 'code') {
    cy.mount(
      <ConformAdapter>
        <Form.Root schema={otpCodeClientSchema} method="POST" defaultValues={{ code: '' }}>
          <OtpCodeField label={label} name={name} />
        </Form.Root>
      </ConformAdapter>
    );
  }

  it('renders a datum-ui Form.Field labelled control wired with inputMode/autoComplete (not a bare input)', () => {
    mountOtpField('Email code', 'code');
    cy.findByLabelText(/Email code/)
      .should('exist')
      .and('have.attr', 'inputmode', 'numeric')
      .and('have.attr', 'autocomplete', 'one-time-code')
      .and('have.attr', 'name', 'code')
      .and('have.attr', 'data-slot', 'input');
    cy.get('label[data-slot="label"]').should('exist');
  });
});

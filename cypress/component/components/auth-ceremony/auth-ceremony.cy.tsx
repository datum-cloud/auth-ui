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

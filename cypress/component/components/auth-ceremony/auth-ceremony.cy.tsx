import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { Form } from '@datum-cloud/datum-ui/form';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';

// cy.mount wraps in MemoryRouter + I18nProvider; set path:'*' so useLocation returns
// whatever initialEntries[0] is (BackLink needs the pathname to resolve its predecessor).
const OPTS = { initialEntries: ['/login/password'], path: '*' };

describe('AuthCeremony shell', () => {
  it('renders title, description, and children', () => {
    cy.mount(
      <AuthCeremony title="Enter your code" description="We sent it to you">
        <p>child-body</p>
      </AuthCeremony>,
      OPTS
    );
    cy.contains('Enter your code').should('exist');
    cy.contains('We sent it to you').should('exist');
    cy.contains('child-body').should('exist');
  });

  it('owns the ceremony layout div with the tokenized spacing class', () => {
    cy.mount(
      <AuthCeremony title="t">
        <p>child-body</p>
      </AuthCeremony>,
      OPTS
    );
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').should('exist');
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').within(() => {
      cy.contains('child-body').should('exist');
    });
  });

  it('mounts IdentityBadge only when loginName is present (threading requestId/organization)', () => {
    cy.mount(
      <AuthCeremony title="t">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.contains(/Signing in as/).should('not.exist');

    cy.mount(
      <AuthCeremony title="t" loginName="a@b.test" requestId="rq1" organization="acme">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.contains(/Signing in as/).should('exist');
    cy.contains('a@b.test').should('exist');
    cy.findByRole('link', { name: /Not you\?/ })
      .should('have.attr', 'href')
      .and('include', 'requestId=rq1')
      .and('include', 'organization=acme');
  });

  it('renders an inline FormError (role="alert") when error is set, and none when unset', () => {
    cy.mount(
      <AuthCeremony title="t">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.get('[role="alert"]').should('not.exist');

    cy.mount(
      <AuthCeremony title="t" error="Something is wrong">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.findByRole('alert').should('contain.text', 'Something is wrong');
  });

  it('renders a recovery <Link> inside the banner when recovery is set (recoverable code)', () => {
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

  it('renders NO recovery link when recovery is unset (non-recoverable code → banner only)', () => {
    cy.mount(
      <AuthCeremony title="t" error="Incorrect credentials. Please try again.">
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.findByRole('alert').should('contain.text', 'Incorrect credentials. Please try again.');
    cy.findByRole('link', { name: 'Sign in again' }).should('not.exist');
    cy.findByRole('link', { name: 'Start over' }).should('not.exist');
  });

  it('renders NO recovery link when there is no error even if recovery is somehow set', () => {
    cy.mount(
      <AuthCeremony title="t" recovery={{ to: '/login', label: 'Sign in again' }}>
        <span>c</span>
      </AuthCeremony>,
      OPTS
    );
    cy.findByRole('link', { name: 'Sign in again' }).should('not.exist');
  });

  it('renders children before the BackLink (ceremony body then back control)', () => {
    cy.mount(
      <AuthCeremony title="t">
        <p>child-body</p>
      </AuthCeremony>,
      OPTS
    );
    // child-body must precede BackLink in document order.
    cy.contains('child-body').then(($child) => {
      cy.findByRole('link', { name: 'Back' }).then(($back) => {
        // DOCUMENT_POSITION_FOLLOWING means $back comes after $child.
        expect($child[0].compareDocumentPosition($back[0]) & Node.DOCUMENT_POSITION_FOLLOWING).to.be
          .ok;
      });
    });
    // Both live inside the owned layout div.
    cy.get('div.flex.flex-col.items-baseline.justify-center.gap-4').within(() => {
      cy.findByRole('link', { name: 'Back' }).should('exist');
    });
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

  it('honours a custom field name', () => {
    mountOtpField('Authenticator code', 'token');
    cy.findByLabelText(/Authenticator code/)
      .should('have.attr', 'name', 'token')
      .and('have.attr', 'data-slot', 'input');
  });
});

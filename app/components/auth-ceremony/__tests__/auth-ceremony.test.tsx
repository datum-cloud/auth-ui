import { AuthCeremony } from '../auth-ceremony';
import { OtpCodeField } from '../otp-code-field';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { Form } from '@datum-cloud/datum-ui/form';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// AuthCeremony composes AuthCard (→ BlankLayout's <Link>) and BackLink (useLocation),
// so it must render inside a Router. Match the repo's established component-test setup:
// createRoutesStub + a Trans macro mock (see back-link / identity-badge tests).
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// /login/password has a BackLink predecessor (→ /login), so the BackLink renders here
// and we can assert children-then-BackLink ordering.
function renderCeremony(ui: ReactNode, path = '/login/password') {
  const Stub = createRoutesStub([{ path: '*', Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={[path]} />);
}

describe('AuthCeremony shell', () => {
  it('renders title, description, and children', () => {
    renderCeremony(
      <AuthCeremony title="Enter your code" description="We sent it to you">
        <p>child-body</p>
      </AuthCeremony>
    );
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    expect(screen.getByText('We sent it to you')).toBeInTheDocument();
    expect(screen.getByText('child-body')).toBeInTheDocument();
  });

  it('owns the ceremony layout div with the tokenized spacing class', () => {
    const { container } = renderCeremony(
      <AuthCeremony title="t">
        <p>child-body</p>
      </AuthCeremony>
    );
    // The scaffold the routes hand-assemble today is now owned by AuthCeremony.
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
    // The children render inside the owned layout div (not a sibling of it).
    expect(within(layout as HTMLElement).getByText('child-body')).toBeInTheDocument();
  });

  it('mounts IdentityBadge only when loginName is present (threading requestId/organization)', () => {
    const { rerender } = render(<IdentityCeremonyStub loginName={undefined} />);
    expect(screen.queryByText(/Signing in as/)).not.toBeInTheDocument();

    rerender(<IdentityCeremonyStub loginName="a@b.test" requestId="rq1" organization="acme" />);
    expect(screen.getByText(/Signing in as/)).toBeInTheDocument();
    expect(screen.getByText('a@b.test')).toBeInTheDocument();
    // "Not you?" threads requestId + organization (but never loginName).
    const notYou = screen.getByRole('link', { name: /Not you\?/ });
    const href = notYou.getAttribute('href') ?? '';
    expect(href).toContain('requestId=rq1');
    expect(href).toContain('organization=acme');
  });

  it('renders an inline FormError (role="alert") when error is set, and none when unset', () => {
    const { rerender } = render(<AuthCeremonyStub error={undefined} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<AuthCeremonyStub error="Something is wrong" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something is wrong');
  });

  // ── inline recovery affordance ──────────────────────────────────────────────
  // A recoverable error renders the inline banner AND a recovery <Link> with the
  // recovery label pointing at the recovery path. A non-recoverable error (recovery
  // undefined) renders the banner WITHOUT any recovery link.
  it('renders a recovery <Link> inside the banner when recovery is set (recoverable code)', () => {
    renderCeremony(
      <AuthCeremony
        title="t"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <span>c</span>
      </AuthCeremony>
    );
    const link = screen.getByRole('link', { name: 'Sign in again' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('renders NO recovery link when recovery is unset (non-recoverable code → banner only)', () => {
    renderCeremony(
      <AuthCeremony title="t" error="Incorrect credentials. Please try again.">
        <span>c</span>
      </AuthCeremony>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect credentials. Please try again.');
    expect(screen.queryByRole('link', { name: 'Sign in again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start over' })).not.toBeInTheDocument();
  });

  it('renders NO recovery link when there is no error even if recovery is somehow set', () => {
    renderCeremony(
      <AuthCeremony title="t" recovery={{ to: '/login', label: 'Sign in again' }}>
        <span>c</span>
      </AuthCeremony>
    );
    // No banner → no recovery affordance (the link is gated on the error surface).
    expect(screen.queryByRole('link', { name: 'Sign in again' })).not.toBeInTheDocument();
  });

  it('renders children before the BackLink (ceremony body then back control)', () => {
    const { container } = renderCeremony(
      <AuthCeremony title="t">
        <p>child-body</p>
      </AuthCeremony>
    );
    const child = screen.getByText('child-body');
    const back = screen.getByRole('link', { name: 'Back' });
    // child-body must appear before the BackLink in document order.
    expect(child.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // and both live inside the owned layout div.
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
    expect(within(layout as HTMLElement).getByRole('link', { name: 'Back' })).toBeInTheDocument();
  });
});

// Wrap so rerender stays inside the same Router instance (createRoutesStub is the host).
function AuthCeremonyStub({ error }: { error?: string }) {
  const Stub = createRoutesStub([
    {
      path: '*',
      Component: () => (
        <AuthCeremony title="t" error={error}>
          <span>c</span>
        </AuthCeremony>
      ),
    },
  ]);
  return <Stub initialEntries={['/login/password']} />;
}

function IdentityCeremonyStub({
  loginName,
  requestId,
  organization,
}: {
  loginName?: string;
  requestId?: string;
  organization?: string;
}) {
  const Stub = createRoutesStub([
    {
      path: '*',
      Component: () => (
        <AuthCeremony
          title="t"
          loginName={loginName}
          requestId={requestId}
          organization={organization}>
          <span>c</span>
        </AuthCeremony>
      ),
    },
  ]);
  return <Stub initialEntries={['/login/password']} />;
}

describe('OtpCodeField', () => {
  // Composes inside a Form.Root (datum-ui) whose schema still drives validation — it is a
  // Form.Field labelled control, NOT a bare input.
  function renderOtpField(label = 'Email code', name = 'code') {
    return render(
      <ConformAdapter>
        <Form.Root schema={otpCodeClientSchema} method="POST" defaultValues={{ code: '' }}>
          <OtpCodeField label={label} name={name} />
        </Form.Root>
      </ConformAdapter>
    );
  }

  it('renders a datum-ui Form.Field labelled control wired with inputMode/autoComplete (not a bare input)', () => {
    const { container } = renderOtpField('Email code', 'code');
    // Label text matches via substring (Form.Field appends a required "*" marker).
    const input = screen.getByLabelText(/Email code/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('name')).toBe('code');
    // Discriminator: this is a datum-ui Form.Input (carries data-slot="input"), wired to a
    // datum-ui Form.Field label via matching for/id — NOT a hand-rolled <label>+<input>.
    expect(input.getAttribute('data-slot')).toBe('input');
    const label = container.querySelector('label[data-slot="label"]');
    expect(label).not.toBeNull();
    expect(label?.getAttribute('for')).toBe(input.id);
  });

  it('honours a custom field name', () => {
    renderOtpField('Authenticator code', 'token');
    const input = screen.getByLabelText(/Authenticator code/) as HTMLInputElement;
    expect(input.getAttribute('name')).toBe('token');
    expect(input.getAttribute('data-slot')).toBe('input');
  });
});

/**
 * Durable a11y regression guard for the ceremony/auth components.
 *
 * Three layers, all under `test:unit` (they lift the coverage ratchet — NOT a
 * new gate check):
 *   1. axe-core STRUCTURAL/ARIA — `axe.run(container)` reports 0 violations on
 *      AuthCeremony, OtpCodeField, AuthFormFields, BackLink, and the inline error
 *      banner. (color-contrast is browser-only → live cypress-axe + visual baseline.)
 *   2. Focus order / keyboard — userEvent.tab() walks a logical order, never traps,
 *      and the recovery <Link> inside the error banner is reachable.
 *   3. prefers-reduced-motion — with matchMedia mocked to `reduce`, the ceremony
 *      renders identically and carries no JS-driven / layout-shifting motion
 *      (reduced-motion is structurally honored on these screens).
 *
 * Router + Lingui setup mirrors the repo convention (createRoutesStub + Trans mock;
 * see auth-ceremony / back-link / identity-badge tests).
 */
import { AuthCeremony } from '../auth-ceremony/auth-ceremony';
import { OtpCodeField } from '../auth-ceremony/otp-code-field';
import { AuthFormFields } from '../auth-form/auth-form-fields';
import { BackLink } from '../back-link/back-link';
import { FormError } from '../form-error/form-error';
import { expectNoAxeViolations, tabbableOrder, positiveTabindexElements } from './axe-helper';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { Form } from '@datum-cloud/datum-ui/form';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// AuthCeremony / BackLink read useLocation, AuthCard renders a <Link> — so every
// render must live inside a Router. /login/password has a BackLink predecessor
// (→ /login), so the BackLink renders and is part of the focus order.
function renderAt(ui: ReactNode, path = '/login/password') {
  const Stub = createRoutesStub([{ path: '*', Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={[path]} />);
}

// A complete ceremony body: a labelled OTP field + the hidden-input cluster, so the
// axe + keyboard assertions exercise a realistic verify screen (not an empty shell).
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

describe('a11y guard — axe structural/aria (0 violations)', () => {
  it('AuthCeremony with a full verify body has no axe violations', async () => {
    const { container } = renderAt(
      <AuthCeremony title="Enter your code" description="We sent a code to your email">
        <CeremonyBody />
      </AuthCeremony>
    );
    await expectNoAxeViolations(container);
  });

  it('AuthCeremony with the inline error banner + recovery link has no axe violations', async () => {
    const { container } = renderAt(
      <AuthCeremony
        title="Enter your code"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <CeremonyBody />
      </AuthCeremony>
    );
    await expectNoAxeViolations(container);
  });

  it('OtpCodeField (datum-ui Form.Field labelled control) has no axe violations', async () => {
    const { container } = render(
      <ConformAdapter>
        <Form.Root schema={otpCodeClientSchema} method="POST" defaultValues={{ code: '' }}>
          <OtpCodeField label="Authenticator code" />
        </Form.Root>
      </ConformAdapter>
    );
    await expectNoAxeViolations(container);
  });

  it('AuthFormFields (hidden-input cluster) has no axe violations', async () => {
    // Hidden inputs must live in a <form> for valid structure.
    const { container } = render(
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
    await expectNoAxeViolations(container);
  });

  it('BackLink (single styled <a>) has no axe violations', async () => {
    const { container } = renderAt(<BackLink />);
    await expectNoAxeViolations(container);
  });

  it('inline error banner (FormError, role="alert") has no axe violations', async () => {
    const { container } = render(<FormError>Incorrect credentials. Please try again.</FormError>);
    await expectNoAxeViolations(container);
    // The banner announces to AT: role="alert" + assertive live region.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('a11y guard — focus order / keyboard (logical order, no trap, recovery reachable)', () => {
  it('exposes a logical forward tab order: OTP field → submit → BackLink', () => {
    const { container } = renderAt(
      <AuthCeremony title="Enter your code">
        <CeremonyBody />
      </AuthCeremony>
    );

    const order = tabbableOrder(container);
    const otpInput = screen.getByLabelText(/Email code/);
    const submit = screen.getByRole('button', { name: 'Verify' });
    const back = screen.getByRole('link', { name: 'Back' });

    // All three reachable controls are in the tabbable set, in DOM/visual order:
    // the field, then the submit button, then the back control. (Hidden inputs
    // from AuthFormFields are correctly excluded.)
    const idx = (el: HTMLElement) => order.indexOf(el);
    expect(idx(otpInput)).toBeGreaterThanOrEqual(0);
    expect(idx(submit)).toBeGreaterThan(idx(otpInput));
    expect(idx(back)).toBeGreaterThan(idx(submit));
  });

  it('uses no positive tabindex (no manual focus-order trap)', () => {
    const { container } = renderAt(
      <AuthCeremony title="Enter your code">
        <CeremonyBody />
      </AuthCeremony>
    );
    // A positive tabindex jumps the natural order and is the classic focus trap /
    // out-of-order foot-gun — assert there are none on the ceremony.
    expect(positiveTabindexElements(container)).toHaveLength(0);
  });

  it('keeps the recovery <Link> inside the error banner in the tab order (reachable)', () => {
    const { container } = renderAt(
      <AuthCeremony
        title="Enter your code"
        error="Your session has expired."
        recovery={{ to: '/login', label: 'Sign in again' }}>
        <button type="submit">Verify</button>
      </AuthCeremony>
    );

    const recovery = screen.getByRole('link', { name: 'Sign in again' });
    const order = tabbableOrder(container);
    // The recovery affordance is a real tabbable <a href> in the focus order — a
    // keyboard user reaches it without a pointer. It precedes the submit button
    // (banner renders above the body), matching reading order.
    expect(order).toContain(recovery);
    expect(recovery).toHaveAttribute('href', '/login');
    const submit = screen.getByRole('button', { name: 'Verify' });
    expect(order.indexOf(recovery)).toBeLessThan(order.indexOf(submit));
  });
});

describe('a11y guard — prefers-reduced-motion honored', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Mock matchMedia so `(prefers-reduced-motion: reduce)` matches — i.e. the user
    // has asked the OS to reduce motion.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('the reduce preference is active and the ceremony renders without motion-dependent markup', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);

    const { container } = renderAt(
      <AuthCeremony title="Enter your code" description="We sent a code">
        <CeremonyBody />
      </AuthCeremony>
    );

    // The ceremony renders fully under the reduce preference (no crash, no
    // motion-gated branch hiding content).
    expect(screen.getByText('Enter your code')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email code/)).toBeInTheDocument();

    // Reduced-motion is structurally honored: NONE of the audited ceremony markup
    // carries an entrance animation or a layout-shifting transition utility
    // (animate-* / transition-transform / transition-all / motion-safe:*). The only
    // transitions present are color-only hovers (transition-colors), which are not
    // disruptive motion. A regression that adds entrance/position motion to these
    // screens without a reduced-motion guard fails this assertion.
    const motion = container.querySelectorAll(
      '[class*="animate-"], [class*="transition-transform"], [class*="transition-all"], [class*="motion-safe:"]'
    );
    expect(motion).toHaveLength(0);
  });
});

// @vitest-environment happy-dom
//
// 755-M9 · The /accounts row is itself the SWITCH target.
//
// Each account row renders a row-level <button type=submit> for intent=switch (carrying the
// CSRF + hidden inputs), with the remove control as a SEPARATE sibling form. This pins:
//   • the row submit control exists and posts intent=switch + the right sessionId
//   • the remove control is a distinct submit (intent=remove), NOT nested in the switch button
//   • there are NO nested interactives (no <button> inside a <button>, no <a> inside a <button>)
//   • an IdP badge renders when the (M6) idpName is present, and is absent otherwise
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')), i18n: {} }),
}));

vi.mock('@/utils/errors/auth-error-messages', () => ({
  useAuthErrorMessage: () => (code?: string) => (code ? `msg:${code}` : undefined),
}));

let loaderValue: unknown;
let actionValue: unknown;
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useLoaderData: () => loaderValue,
    useActionData: () => actionValue,
    useNavigation: () => ({ state: 'idle' }),
  };
});

const { default: AccountPicker } = await import('@/routes/accounts');

function mountAccounts(loaderData: unknown) {
  loaderValue = loaderData;
  actionValue = undefined;
  const Stub = createRoutesStub([{ path: '/accounts', Component: AccountPicker }]);
  return render(
    <ConformAdapter>
      <Stub initialEntries={['/accounts']} />
    </ConformAdapter>
  );
}

afterEach(() => {
  cleanup();
  actionValue = undefined;
});

const account = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  loginName: 'alice@acme.test',
  organization: 'org-a',
  displayName: 'Alice',
  nextPath: '/signed-in',
  isActive: true,
  ...over,
});

describe('accounts row — 755-M9 row-level switch target', () => {
  it('renders the row itself as a switch submit control with CSRF + hidden inputs', () => {
    const { container } = mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });

    // The switch form carries intent=switch + the sessionId + the CSRF token.
    const switchForm = container.querySelector(
      'form:has(input[name="intent"][value="switch"])'
    ) as HTMLFormElement | null;
    expect(switchForm).not.toBeNull();
    expect(switchForm!.querySelector('input[name="sessionId"]')?.getAttribute('value')).toBe('s1');
    expect(switchForm!.querySelector('input[name="csrf"]')?.getAttribute('value')).toBe('csrf-tok');

    // The switch form's interactive element is a submit button wrapping the account info.
    const submit = switchForm!.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    expect(within(submit!).getByText('Alice')).toBeInTheDocument();
  });

  it('keeps the remove control as a SEPARATE submit form (not nested in the switch button)', () => {
    const { container } = mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });

    const removeForm = container.querySelector(
      'form:has(input[name="intent"][value="remove"])'
    ) as HTMLFormElement | null;
    expect(removeForm).not.toBeNull();
    expect(removeForm!.querySelector('button[type="submit"]')).not.toBeNull();

    // The switch and remove forms are distinct elements.
    const switchForm = container.querySelector('form:has(input[value="switch"])');
    expect(switchForm).not.toBe(removeForm);
    // The remove form is NOT a descendant of the switch button.
    const switchButton = switchForm!.querySelector('button[type="submit"]');
    expect(switchButton!.contains(removeForm)).toBe(false);
  });

  it('has NO nested interactive elements (no button/anchor inside a button)', () => {
    const { container } = mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()] });

    for (const btn of Array.from(container.querySelectorAll('button'))) {
      expect(btn.querySelector('button')).toBeNull();
      expect(btn.querySelector('a')).toBeNull();
    }
  });

  it('threads the ceremony requestId into the switch form hidden input when present', () => {
    const { container } = mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: 'oidc_V3-current',
    });

    const switchForm = container.querySelector(
      'form:has(input[name="intent"][value="switch"])'
    ) as HTMLFormElement | null;
    expect(switchForm).not.toBeNull();
    expect(switchForm!.querySelector('input[name="requestId"]')?.getAttribute('value')).toBe(
      'oidc_V3-current'
    );

    // The REMOVE form must also carry the ceremony id so a mid-ceremony remove keeps the flow.
    const removeForm = container.querySelector(
      'form:has(input[name="intent"][value="remove"])'
    ) as HTMLFormElement | null;
    expect(removeForm).not.toBeNull();
    expect(removeForm!.querySelector('input[name="requestId"]')?.getAttribute('value')).toBe(
      'oidc_V3-current'
    );
  });

  it('omits the requestId hidden input when no ceremony is active', () => {
    const { container } = mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: null,
    });

    expect(container.querySelector('input[name="requestId"]')).toBeNull();
  });

  it('threads the ceremony requestId into the "Add another account" link when present', () => {
    mountAccounts({
      csrfToken: 'csrf-tok',
      accounts: [account()],
      requestId: 'oidc_V3-current',
    });

    const link = screen.getByRole('link', { name: 'Add another account' });
    expect(link.getAttribute('href')).toBe('/login?requestId=oidc_V3-current');
  });

  it('links "Add another account" to a plain /login when no ceremony is active', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [account()], requestId: null });

    const link = screen.getByRole('link', { name: 'Add another account' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('threads the ceremony requestId into the empty-state "Add an account" link', () => {
    mountAccounts({ csrfToken: 'csrf-tok', accounts: [], requestId: 'oidc_V3-current' });

    const link = screen.getByRole('link', { name: 'Add an account' });
    expect(link.getAttribute('href')).toBe('/login?requestId=oidc_V3-current');
  });

  it('renders an IdP badge when idpName is present', () => {
    mountAccounts({ csrfToken: 't', accounts: [account({ idpName: 'Google' })] });
    expect(screen.getByText('Google')).toBeInTheDocument();
  });

  it('renders no IdP badge when idpName is absent', () => {
    mountAccounts({ csrfToken: 't', accounts: [account()] });
    expect(screen.queryByText('Google')).not.toBeInTheDocument();
  });
});

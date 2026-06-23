// @vitest-environment happy-dom
//
// signup/method — render adoption tests.
//
// Pins the shared-primitive adoption on the method picker:
//   - the screen is wrapped in <AuthCeremony> (it owns the tokenized ceremony layout
//     div + inline error surface), replacing the bare <AuthCard>
//   - the csrf + identity hidden inputs come from the shared <AuthFormFields> cluster
//
// The ceremony-layout assertion is the *intended* change, so it fails against the
// earlier AuthCard-only implementation.
import SignupMethod from '@/routes/signup/method';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — passthrough it under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

const VIEW = { showEmailLink: true, showPasskey: true, showPassword: true };

const LOADER_DATA = {
  csrfToken: 'csrf-token-xyz',
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
  organization: undefined,
  requestId: undefined,
  deviceTrackingToken: undefined,
  view: VIEW,
};

function renderMethod() {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([
    {
      path: '/signup/method',
      Component: () => <SignupMethod />,
      loader: () => LOADER_DATA,
      action: () => null,
    },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <ConformAdapter>
        <Stub initialEntries={['/signup/method']} />
      </ConformAdapter>
    </I18nProvider>
  );
}

describe('signup/method — render adoption', () => {
  it('wraps the screen in the AuthCeremony layout (owned tokenized spacing div)', async () => {
    const { container } = renderMethod();
    // AuthCeremony owns the scaffold the route previously hand-assembled.
    await screen.findByText('john.doe@example.com', { exact: false });
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
  });

  it('emits the shared csrf hidden input from AuthFormFields (one per method form)', async () => {
    const { container } = renderMethod();
    await screen.findByText('john.doe@example.com', { exact: false });
    // CsrfInput emits name="csrf" with the loader token (CSRF_FORM_KEY === 'csrf').
    const csrfInputs = container.querySelectorAll('input[name="csrf"][type="hidden"]');
    expect(csrfInputs.length).toBeGreaterThan(0);
    csrfInputs.forEach((el) => expect(el.getAttribute('value')).toBe('csrf-token-xyz'));
    // identity cluster still present alongside csrf.
    expect(container.querySelectorAll('input[name="loginName"]').length).toBeGreaterThan(0);
  });
});

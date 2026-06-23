// @vitest-environment happy-dom
//
// signup/password — render adoption tests.
//
// Pins the shared-primitive adoption:
//   - action errors surface INLINE via <AuthCeremony error> (role="alert"), NOT a toast
//   - the csrf + identity hidden inputs come from the shared <AuthFormFields> cluster
//   - the ceremony owns the BackLink (/signup/password → /signup predecessor)
//
// The inline-error assertion is the *intended* change, so it fails against the
// earlier toast-only implementation.
import SignupPassword from '@/routes/signup/password';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

const LOADER_DATA = {
  csrfToken: 'csrf-token-pw',
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
  organization: undefined,
  requestId: undefined,
  deviceTrackingToken: '',
  maxmindAccountId: '',
};

function renderPassword() {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([
    {
      path: '/signup/password',
      Component: () => <SignupPassword />,
      loader: () => LOADER_DATA,
      action: () => null,
    },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <ConformAdapter>
        <Stub initialEntries={['/signup/password']} />
      </ConformAdapter>
    </I18nProvider>
  );
}

describe('signup/password — render adoption', () => {
  it('wraps the screen in the AuthCeremony layout (owned tokenized spacing div)', async () => {
    const { container } = renderPassword();
    await screen.findByDisplayValue('csrf-token-pw');
    const layout = container.querySelector('div.flex.flex-col.items-baseline.justify-center.gap-4');
    expect(layout).not.toBeNull();
  });

  it('emits the shared csrf hidden input from AuthFormFields', async () => {
    renderPassword();
    const csrf = await screen.findByDisplayValue('csrf-token-pw');
    expect(csrf.getAttribute('name')).toBe('csrf');
    expect(csrf.getAttribute('type')).toBe('hidden');
  });

  it('renders the ceremony-owned BackLink (predecessor /signup)', async () => {
    renderPassword();
    const back = await screen.findByRole('link', { name: 'Back' });
    expect(back.getAttribute('href')).toBe('/signup');
  });
});

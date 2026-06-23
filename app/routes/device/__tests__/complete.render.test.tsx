// @vitest-environment happy-dom
//
// device/complete — terminal render tests. The component reads the validated ?decision from
// loader data and renders the matching terminal copy (authorize success / deny). It is the
// landing the /device/authorize action redirects to after applying the decision; there is no
// consent form and no provider call.
import DeviceComplete from '@/routes/device/complete';
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

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function renderWithDecision(decision: 'authorize' | 'deny') {
  const Stub = createRoutesStub([
    {
      path: '/device/complete',
      Component: DeviceComplete,
      loader: () => ({ decision }),
    },
  ]);
  render(
    <I18nProvider i18n={i18n}>
      <Stub initialEntries={['/device/complete']} />
    </I18nProvider>
  );
}

describe('device/complete — terminal render', () => {
  it('authorize → renders the "Authorization complete" success card', async () => {
    renderWithDecision('authorize');
    expect(await screen.findByText('Authorization complete')).toBeInTheDocument();
    expect(screen.getByText('You may return to your device.')).toBeInTheDocument();
  });

  it('deny → renders a clear denied message', async () => {
    renderWithDecision('deny');
    expect(await screen.findByText('Device denied')).toBeInTheDocument();
  });

  it('renders no consent (Authorize/Deny) buttons on either terminal screen', () => {
    renderWithDecision('authorize');
    expect(screen.queryByRole('button', { name: /authorize/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument();
  });
});

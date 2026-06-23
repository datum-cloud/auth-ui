// @vitest-environment happy-dom
//
// device/authorize — tailored-recovery render tests.
//
// A bare GET to /device/authorize (no user_code) must NOT fall through to the generic
// root ErrorBoundary ("Something went wrong" + only a link home). Instead the loader
// routes loadDeviceConsent's missing/stale-code error through the AppError spine and the
// route renders a TAILORED in-component recovery — an AuthCard ("Code expired") + a
// "Enter a new code" <Link> back to paths.device.index() (/device) — mirroring
// signup/complete's "Link expired" / "Start over" affordance.
//
// The loader still returns the pinned 400 the Cypress url-resolution gate asserts; that
// half is covered by the service/loader test (authorize.recovery.loader.test.ts).
import DeviceAuthorize from '@/routes/device/authorize';
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

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function renderWithLoaderData(loaderData: unknown) {
  const Stub = createRoutesStub([
    {
      path: '/device/authorize',
      Component: DeviceAuthorize,
      loader: () => loaderData,
    },
  ]);
  render(
    <I18nProvider i18n={i18n}>
      <Stub initialEntries={['/device/authorize']} />
    </I18nProvider>
  );
}

describe('device/authorize — tailored recovery (missing/stale user_code)', () => {
  it('renders the tailored recovery card with a link back to /device when the loader carries the recovery error', async () => {
    // The loader returns the AppError-spine error payload for the missing/stale code path.
    renderWithLoaderData({ error: { code: 'INVALID_INPUT', recovery: 'device' } });

    // The tailored recovery title (an h1 from AuthCard) — NOT the generic "Something went wrong".
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();

    // The recovery affordance: a link back to the device code-entry screen (/device). The
    // datum-ui Button renders the <a> via asChild, so resolve the anchor from its label text.
    const link = (await screen.findByText('Enter a new code')).closest('a');
    expect(link).toHaveAttribute('href', '/device');
  });

  it('does NOT render the consent form when the recovery error is present', () => {
    renderWithLoaderData({ error: { code: 'INVALID_INPUT', recovery: 'device' } });
    // No Authorize/Deny buttons on the recovery page.
    expect(screen.queryByRole('button', { name: /authorize/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument();
  });
});

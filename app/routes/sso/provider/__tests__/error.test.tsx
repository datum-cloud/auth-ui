// @vitest-environment happy-dom
//
// Tests for sso.$provider.error route component — CODE-MIN-06.
//
// sso.tsx redirects to /sso/ldap/error?reason=ldap-link-unsupported but the
// REASONS map had no entry for that key, so the user always saw the generic
// "Something went wrong with {provider}." fallback. This test pins that
// 'ldap-link-unsupported' now maps to a specific, user-readable message.
import SsoError from '@/routes/sso/provider/error';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — it does not run under vitest's esbuild
// pipeline. Replace Trans with a passthrough that renders its children.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderError(reason: string) {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([{ path: '/sso/:provider/error', Component: () => <SsoError /> }]);
  return render(
    <I18nProvider i18n={i18n}>
      <Stub initialEntries={[`/sso/ldap/error?reason=${reason}`]} />
    </I18nProvider>
  );
}

describe('SsoError ldap-link-unsupported (CODE-MIN-06)', () => {
  it('renders a specific message, not the generic fallback', async () => {
    renderError('ldap-link-unsupported');
    expect(await screen.findByText(/can't be linked|not supported|password/i)).toBeTruthy();
    expect(screen.queryByText(/Something went wrong with/i)).toBeNull();
  });
});

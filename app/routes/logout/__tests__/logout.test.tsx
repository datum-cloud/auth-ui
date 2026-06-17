// @vitest-environment happy-dom
//
// Regression (POST /id/logout 405): the logout confirm form is a NATIVE <form> on
// the logout INDEX route, which shares its URL (/id/logout) with the action-less
// logout LAYOUT. React Router routes a POST without the ?index query param to the
// PARENT layout route → "no action for route routes/logout/layout" → 405. RR's
// <Form> component appends ?index automatically when rendered in an index route; a
// native <form> does NOT, so the action attribute must carry ?index explicitly.
// This pins that the rendered confirm form targets the index action.
import Logout from '@/routes/logout/index';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — passthrough under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The component module imports server-only helpers at load time (used by the real
// loader/action, which the stub replaces). Mock them so importing the component
// under happy-dom does not pull in server runtime code.
vi.mock('@/resources/session', () => ({
  performLogout: vi.fn(),
  logoutOutcomeToResponse: vi.fn(),
}));
vi.mock('@/server/auth-context.server', () => ({ providerForRequest: vi.fn() }));
vi.mock('@/server/csrf', () => ({ assertCsrf: vi.fn(), getCsrfToken: vi.fn() }));

function renderLogout() {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const Stub = createRoutesStub([
    { path: '/logout', loader: () => ({ csrfToken: 'test-csrf' }), Component: () => <Logout /> },
  ]);
  return render(
    <I18nProvider i18n={i18n}>
      <Stub initialEntries={['/logout']} />
    </I18nProvider>
  );
}

describe('Logout confirm form — index-route POST disambiguation', () => {
  it('targets the index action via ?index (not the action-less layout)', async () => {
    const { container } = renderLogout();
    // Wait for the stub loader to resolve and the form to render.
    await screen.findByRole('button', { name: /sign out/i });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')).toBe('post');

    // Native <form> posts to its action verbatim. Without ?index, RR routes the POST
    // to the action-less logout/layout (→ 405); ?index targets routes/logout/index,
    // which owns the action.
    expect(form?.getAttribute('action') ?? '').toContain('?index');
  });
});

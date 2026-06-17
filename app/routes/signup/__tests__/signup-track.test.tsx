// @vitest-environment happy-dom
//
// Conversion-tracking regression: fires signup_submitted when the "check your
// email" branch renders. Task 8 representative route test — proves TrackOnMount
// is wired into the sent branch of signup/index.tsx.
//
// Approach: fallback path from plan. The full component uses @datum-cloud/datum-ui/form
// which requires an adapter provider (ConformAdapter/RHFAdapter) — unavailable in the
// happy-dom test environment. We skip driving the action via requestSubmit() and instead
// render the sent branch directly using createRoutesStub with an action that immediately
// returns the sent payload, confirmed visible via waitFor on the heading text.
import Signup from '@/routes/signup/index';
import { render, screen, waitFor } from '@testing-library/react';
import { trackEvent } from 'fathom-client';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

vi.mock('fathom-client', () => ({
  load: vi.fn(),
  trackPageview: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

// @datum-cloud/datum-ui/form requires a ConformAdapter/RHFAdapter provider at runtime.
// Mock it to a plain <form> passthrough so the component renders under happy-dom.
vi.mock('@datum-cloud/datum-ui/form', () => ({
  Form: {
    Root: ({
      children,
      formComponent: FC,
      ...props
    }: {
      children: ReactNode;
      formComponent: React.ElementType;
      [key: string]: unknown;
    }) => {
      const El = FC ?? 'form';
      return <El {...props}>{children}</El>;
    },
    Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  },
}));

// Server-only modules imported by the route file — must be mocked so importing
// the component under happy-dom does not pull in Node-only runtime code.
vi.mock('@/modules/auth/session/cookie', () => ({
  readSessions: vi.fn(),
  serializeSessions: vi.fn(),
}));
vi.mock('@/resources/signup', () => ({
  registerAndLinkIdp: vi.fn(),
  passwordFirstHandoff: vi.fn(),
  registerPasskeyFirst: vi.fn(),
}));
vi.mock('@/resources/signup/signup.schema', () => ({
  registerSchema: { safeParse: vi.fn() },
  registerClientSchema: {},
}));
vi.mock('@/resources/schemas/check-your-email.schema', () => ({
  genericCheckYourEmail: vi.fn(),
}));
vi.mock('@/server/app-origin.server', () => ({ trustedAppOrigin: vi.fn() }));
vi.mock('@/server/auth-context.server', () => ({ providerForRequest: vi.fn() }));
vi.mock('@/server/csrf', () => ({
  getCsrfToken: vi.fn(),
  assertCsrf: vi.fn(),
}));
vi.mock('@/server/env', () => ({ requireEmailVerification: vi.fn() }));

describe('signup index — conversion tracking', () => {
  it('fires signup_submitted when the "check your email" branch renders', async () => {
    const Stub = createRoutesStub([
      {
        path: '/signup',
        Component: Signup,
        loader: () => ({
          csrfToken: 'x',
          branding: undefined,
          organization: undefined,
          requestId: undefined,
          idp: undefined,
          prefill: { email: '', firstName: '', lastName: '' },
        }),
        action: () => ({ sent: true as const, email: 'a@b.test' }),
      },
    ]);
    const { container } = render(<Stub initialEntries={['/signup']} />);

    // Wait for the loader to resolve and the form to appear before submitting.
    await screen.findByRole('button', { name: /continue/i });

    // Submit the form to drive the action → "sent" render branch.
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    form?.requestSubmit();

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeTruthy();
    });

    expect(trackEvent).toHaveBeenCalledWith('signup_submitted');
  });
});

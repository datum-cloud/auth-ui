// @vitest-environment happy-dom
//
// password/new and password/change use the AuthCard scaffold (not
// AuthCeremony), so they render <BackLink/> explicitly. previous-step.ts maps both
// to /login/password; createRoutesStub mounts each at its real path so useLocation()
// drives previousStepFor. This pins that the Back control appears (additive — the
// rest of each form is unchanged).
//
// These routes also surface their action error INLINE: useAuthActionError resolves
// actionData.error → a message rendered in a <FormError> (role="alert") inside the
// form. The per-route toast was removed; the inline banner is the sole surface, pinned
// by the "inline action error" tests below.
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')), i18n: {} }),
}));

// useAuthErrorMessage maps the action error code → a user-facing message. Stub it so the
// inline-error assertions are deterministic (no Lingui macro runtime needed).
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

const { default: PasswordNew } = await import('@/routes/password/new');
const { default: PasswordChange } = await import('@/routes/password/change');

function mountAt(
  Component: () => ReactNode,
  path: string,
  loaderData: unknown,
  actionData: unknown = undefined
) {
  loaderValue = loaderData;
  actionValue = actionData;
  const Stub = createRoutesStub([{ path, Component }]);
  // ConformAdapter satisfies the datum-ui Form.Root adapter requirement.
  return render(
    <ConformAdapter>
      <Stub initialEntries={[`${path}?loginName=a%40b.test`]} />
    </ConformAdapter>
  );
}

afterEach(() => {
  cleanup();
  actionValue = undefined;
});

describe('password BackLink', () => {
  it('password/new renders a Back link to /login/password (preserving the query)', async () => {
    const { container } = mountAt(PasswordNew, '/password/new', {
      csrfToken: 't',
      code: 'c',
      userId: 'u',
      organization: undefined,
      requestId: undefined,
    });
    await screen.findByText(/Choose a new password/);
    const links = Array.from(container.querySelectorAll('a')).map(
      (a) => a.getAttribute('href') ?? ''
    );
    const back = links.find((h) => h.startsWith('/login/password'));
    expect(back).toBeDefined();
    expect(back).toContain('loginName=a%40b.test');
  });

  it('password/change renders a Back link to /login/password', async () => {
    const { container } = mountAt(PasswordChange, '/password/change', {
      csrfToken: 't',
      sessionId: 's',
      loginName: 'a@b.test',
      requestId: undefined,
    });
    await screen.findByText(/Change your password/);
    const links = Array.from(container.querySelectorAll('a')).map(
      (a) => a.getAttribute('href') ?? ''
    );
    const back = links.find((h) => h.startsWith('/login/password'));
    expect(back).toBeDefined();
  });
});

describe('password inline action error (no toast)', () => {
  it('password/new renders the action error inline in a role="alert" banner', async () => {
    mountAt(
      PasswordNew,
      '/password/new',
      { csrfToken: 't', code: 'c', userId: 'u', organization: undefined, requestId: undefined },
      { error: 'INVALID_INPUT' }
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:INVALID_INPUT');
  });

  it('password/new renders NO alert banner when there is no action error', async () => {
    mountAt(PasswordNew, '/password/new', {
      csrfToken: 't',
      code: 'c',
      userId: 'u',
      organization: undefined,
      requestId: undefined,
    });
    await screen.findByText(/Choose a new password/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('password/change renders the action error inline in a role="alert" banner', async () => {
    mountAt(
      PasswordChange,
      '/password/change',
      { csrfToken: 't', sessionId: 's', loginName: 'a@b.test', requestId: undefined },
      { error: 'PASSWORD_TOO_SHORT' }
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('msg:PASSWORD_TOO_SHORT');
  });

  it('password/change renders NO alert banner when there is no action error', async () => {
    mountAt(PasswordChange, '/password/change', {
      csrfToken: 't',
      sessionId: 's',
      loginName: 'a@b.test',
      requestId: undefined,
    });
    await screen.findByText(/Change your password/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

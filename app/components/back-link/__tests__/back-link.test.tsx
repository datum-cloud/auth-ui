import { BackLink } from '@/components/back-link/back-link';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderAt(path: string) {
  const Stub = createRoutesStub([{ path: '*', Component: () => <BackLink /> }]);
  return render(<Stub initialEntries={[path]} />);
}

describe('BackLink', () => {
  it('links /login/password back to /login, preserving the query', () => {
    renderAt('/login/password?loginName=a%40b.c&requestId=oidc_x');
    const href = (screen.getByRole('link') as HTMLAnchorElement).getAttribute('href') ?? '';
    expect(href.startsWith('/login?')).toBe(true);
    expect(href).toContain('loginName=a%40b.c');
    expect(href).toContain('requestId=oidc_x');
  });
  it('renders nothing on a step with no predecessor', () => {
    const { container } = renderAt('/login');
    expect(container.querySelector('a')).toBeNull();
  });
});

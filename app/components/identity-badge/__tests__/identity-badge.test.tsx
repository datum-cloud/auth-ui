import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderBadge(props: { loginName: string; requestId?: string; organization?: string }) {
  const Stub = createRoutesStub([{ path: '/x', Component: () => <IdentityBadge {...props} /> }]);
  return render(<Stub initialEntries={['/x']} />);
}

describe('IdentityBadge', () => {
  it('shows the login name and a "Not you?" link to /login', () => {
    renderBadge({ loginName: 'alice@acme.test' });
    expect(screen.getByText('alice@acme.test')).toBeTruthy();
    const link = screen.getByRole('link', { name: /not you/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/login');
  });
  it('preserves requestId + organization but NOT loginName on the link', () => {
    renderBadge({ loginName: 'alice@acme.test', requestId: 'oidc_abc', organization: 'org-1' });
    const href =
      (screen.getByRole('link', { name: /not you/i }) as HTMLAnchorElement).getAttribute('href') ??
      '';
    expect(href).toContain('/login?');
    expect(href).toContain('requestId=oidc_abc');
    expect(href).toContain('organization=org-1');
    expect(href).not.toContain('loginName');
  });
  it('renders nothing without a loginName', () => {
    const { container } = renderBadge({ loginName: '' });
    expect(container.textContent).toBe('');
  });
});

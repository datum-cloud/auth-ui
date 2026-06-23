import { AuthFormFields } from '../auth-form-fields';
import { CsrfInput } from '../csrf-input';
import { LastUsedBadge } from '../last-used-badge';
import { CSRF_FORM_KEY } from '@/shared';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

// The repo convention is to neutralize the @lingui/react/macro Trans macro in unit
// tests (it requires the Lingui transform vitest does not run); see
// app/components/identity-badge/__tests__/identity-badge.test.tsx.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const hidden = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('input[type=hidden]')).map((i) => ({
    name: i.getAttribute('name'),
    value: i.getAttribute('value'),
  }));

describe('CsrfInput', () => {
  it('renders the csrf hidden input with CSRF_FORM_KEY and the token', () => {
    const { container } = render(<CsrfInput token="tok-123" />);
    expect(hidden(container)).toEqual([{ name: CSRF_FORM_KEY, value: 'tok-123' }]);
  });
});

describe('AuthFormFields', () => {
  it('renders only csrf when no identity props are given', () => {
    const { container } = render(<AuthFormFields csrf="t" />);
    expect(hidden(container)).toEqual([{ name: 'csrf', value: 't' }]);
  });
  it('renders csrf + identity inputs in fixed order, skipping undefined', () => {
    const { container } = render(
      <AuthFormFields csrf="t" loginName="a@b.test" requestId="r1" next="/login/password" />
    );
    expect(hidden(container)).toEqual([
      { name: 'csrf', value: 't' },
      { name: 'loginName', value: 'a@b.test' },
      { name: 'requestId', value: 'r1' },
      { name: 'next', value: '/login/password' },
    ]);
  });
});

describe('LastUsedBadge', () => {
  it('returns null when inactive', () => {
    const { container } = render(<LastUsedBadge active={false} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders something when active', () => {
    const { container } = render(<LastUsedBadge active />);
    expect(container.firstChild).not.toBeNull();
  });
});

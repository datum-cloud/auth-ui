import { FormError } from '@/components/form-error/form-error';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('FormError', () => {
  it('renders children inside an assertive alert region', () => {
    render(<FormError>Something went wrong</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('Something went wrong');
  });
  it('renders nothing when there are no children', () => {
    const { container } = render(<FormError>{null}</FormError>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

// @vitest-environment happy-dom
import { useActionErrorToast } from '../use-action-error-toast';
import { toast } from '@datum-cloud/datum-ui/toast';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@datum-cloud/datum-ui/toast', () => ({
  toast: { error: vi.fn() },
}));

const toastError = toast.error as ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastError.mockClear();
});

describe('useActionErrorToast', () => {
  it('calls toast.error once when a message appears', () => {
    renderHook(() => useActionErrorToast('Something went wrong.'));
    expect(toastError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith('Something went wrong.');
  });

  it('does not call toast.error again on re-render with the same message', () => {
    const { rerender } = renderHook(
      ({ msg }: { msg: string | undefined }) => useActionErrorToast(msg),
      { initialProps: { msg: 'Duplicate error' } }
    );
    expect(toastError).toHaveBeenCalledOnce();
    rerender({ msg: 'Duplicate error' });
    expect(toastError).toHaveBeenCalledOnce();
  });

  it('does not call toast.error when message is undefined', () => {
    renderHook(() => useActionErrorToast(undefined));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('calls toast.error again when message changes', () => {
    const { rerender } = renderHook(
      ({ msg }: { msg: string | undefined }) => useActionErrorToast(msg),
      { initialProps: { msg: 'First error' as string | undefined } }
    );
    expect(toastError).toHaveBeenCalledOnce();
    rerender({ msg: 'Second error' });
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenLastCalledWith('Second error');
  });

  it('resets so a repeated message toasts again after clearing to undefined', () => {
    const { rerender } = renderHook(
      ({ msg }: { msg: string | undefined }) => useActionErrorToast(msg),
      { initialProps: { msg: 'Error' as string | undefined } }
    );
    expect(toastError).toHaveBeenCalledOnce();
    rerender({ msg: undefined });
    rerender({ msg: 'Error' });
    expect(toastError).toHaveBeenCalledTimes(2);
  });
});

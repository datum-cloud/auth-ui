// @vitest-environment happy-dom
//
// Unit test for the code→message catalog (useAuthErrorMessage). The codebase deliberately
// avoids the live Lingui `t` macro under vitest (it needs an i18n provider at runtime), so we
// mock @lingui/react/macro's useLingui to return a `t` that yields the literal template string —
// the same pattern inline-action-error.test.tsx uses. That lets us assert the EXACT message a
// given code resolves to, including the device-code casing fix.
import { useAuthErrorMessage } from '../auth-error-messages';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  useLingui: () => ({
    // Mirror lingui's tagged-template call shape: t`literal` → the literal text.
    t: (strings: TemplateStringsArray, ...exprs: unknown[]) =>
      strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ''), ''),
    i18n: {},
  }),
}));

function resolve(code: string | undefined): string | undefined {
  const { result } = renderHook(() => useAuthErrorMessage());
  return result.current(code);
}

const GENERIC = 'Something went wrong. Please try again.';

describe('useAuthErrorMessage — device-code lookup codes (lowercase)', () => {
  // REGRESSION: device.service.ts emits lowercase outcome codes ('not_found' / 'invalid_code'),
  // but the catalog only had the uppercase 'NOT_FOUND' case, so the device codes fell through to
  // the generic fallback — the /device screen showed "Something went wrong" for a code that simply
  // wasn't found. These cases pin the distinct, accurate device messages.
  it("maps 'not_found' to the device-specific not-found message (NOT the generic fallback)", () => {
    const msg = resolve('not_found');
    expect(msg).toBe(
      'That device code was not found. Check the code on your device and try again.'
    );
    expect(msg).not.toBe(GENERIC);
  });

  it("maps 'invalid_code' to the device-specific invalid message (NOT the generic fallback)", () => {
    const msg = resolve('invalid_code');
    expect(msg).toBe("That device code isn't valid. Check the code on your device and try again.");
    expect(msg).not.toBe(GENERIC);
  });

  it("keeps the uppercase 'NOT_FOUND' generic-resource message distinct from the device one", () => {
    expect(resolve('NOT_FOUND')).toBe(
      "We couldn't find what you were looking for. Please try again."
    );
  });
});

describe('useAuthErrorMessage — baseline behavior', () => {
  it('returns undefined for no code (empty error surface)', () => {
    expect(resolve(undefined)).toBeUndefined();
  });

  it('falls back to the generic message for an unknown code', () => {
    expect(resolve('SOME_UNKNOWN_CODE')).toBe(GENERIC);
  });

  it('resolves a known uppercase code to its specific message', () => {
    expect(resolve('INVALID_CREDENTIALS')).toBe('Incorrect credentials. Please try again.');
  });
});

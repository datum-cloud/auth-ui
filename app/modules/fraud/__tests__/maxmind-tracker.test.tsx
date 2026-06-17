import {
  MaxMindTracker,
  MAXMIND_TOKEN_STORAGE_KEY,
  readMaxMindTrackingToken,
} from '@/modules/fraud/maxmind-tracker';
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
  document.querySelectorAll('script[data-maxmind="device"]').forEach((s) => s.remove());
  window.sessionStorage.clear();
});

describe('MaxMindTracker', () => {
  it('renders nothing and appends no script when accountId is empty', () => {
    const { container } = render(<MaxMindTracker accountId="" />);
    expect(container.firstChild).toBeNull();
    expect(document.querySelector('script[data-maxmind="device"]')).toBeNull();
  });

  it('appends the device.js script exactly once when accountId is set', () => {
    render(<MaxMindTracker accountId="123456" />);
    const scripts = document.querySelectorAll('script[data-maxmind="device"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe('https://device.maxmind.com/js/device.js');
  });
});

describe('readMaxMindTrackingToken', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('returns undefined when no token has been mirrored', () => {
    expect(readMaxMindTrackingToken()).toBeUndefined();
  });

  it('returns the token previously written to sessionStorage', () => {
    window.sessionStorage.setItem(MAXMIND_TOKEN_STORAGE_KEY, 'tok-xyz');
    expect(readMaxMindTrackingToken()).toBe('tok-xyz');
  });
});

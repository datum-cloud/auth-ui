import { shouldShowIdpButtons, shouldAutoStartSingleIdp } from './idp-buttons';
import type { IdProvider } from '@/providers/types';
import { describe, it, expect } from 'vitest';

const google: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };
const github: IdProvider = { id: 'idp-2', name: 'GitHub', type: 'GITHUB' };

describe('shouldShowIdpButtons', () => {
  it('returns true when externalIdp capability is on and idps present', () => {
    expect(shouldShowIdpButtons({ externalIdp: true }, [google])).toBe(true);
  });

  it('returns false when externalIdp capability is off', () => {
    expect(shouldShowIdpButtons({ externalIdp: false }, [google])).toBe(false);
  });

  it('returns false when idps list is empty', () => {
    expect(shouldShowIdpButtons({ externalIdp: true }, [])).toBe(false);
  });
});

describe('shouldAutoStartSingleIdp', () => {
  it('returns true for exactly one IdP with password disabled', () => {
    expect(shouldAutoStartSingleIdp([google], { allowPassword: false })).toBe(true);
  });

  it('returns false when password is allowed', () => {
    expect(shouldAutoStartSingleIdp([google], { allowPassword: true })).toBe(false);
  });

  it('returns false when multiple IdPs exist', () => {
    expect(shouldAutoStartSingleIdp([google, github], { allowPassword: false })).toBe(false);
  });

  it('returns false when idps list is empty', () => {
    expect(shouldAutoStartSingleIdp([], { allowPassword: false })).toBe(false);
  });
});

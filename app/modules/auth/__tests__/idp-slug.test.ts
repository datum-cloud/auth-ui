import { idpTypeToSlug, slugToProvider } from '@/modules/auth/idp-slug';
import type { IdProvider } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

const google: IdProvider = { id: 'idp-g', name: 'Google', type: 'GOOGLE' };
const github: IdProvider = { id: 'idp-h', name: 'GitHub', type: 'GITHUB' };

describe('idpTypeToSlug', () => {
  it('maps Google and GitHub provider types to slugs', () => {
    expect(idpTypeToSlug('GOOGLE')).toBe('google');
    expect(idpTypeToSlug('GITHUB')).toBe('github');
  });
  it('returns null for an unsupported (v1) type', () => {
    expect(idpTypeToSlug('APPLE')).toBeNull();
  });
  it('finds the active provider matching a slug', () => {
    expect(slugToProvider('google', [google, github])).toEqual(google);
    expect(slugToProvider('github', [google, github])).toEqual(github);
    expect(slugToProvider('apple', [google, github])).toBeNull();
  });
});

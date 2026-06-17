import { SUPPORTED_LOCALES } from '@/modules/i18n/lingui';
import { describe, it, expect } from 'vitest';

describe('SUPPORTED_LOCALES', () => {
  it('only English is a supported locale (es removed — CODE-MAJ-11)', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en']);
  });
});

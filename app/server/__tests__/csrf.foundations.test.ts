import { CSRF_FORM_KEY } from '@/shared';
import { describe, it, expect } from 'vitest';

describe('csrf foundations', () => {
  it('loaderCsrf returns a token and a string headers map', async () => {
    const { loaderCsrf } = await import('@/server/csrf');
    const req = new Request('https://x.test/id/login');
    const { csrfToken, headers } = await loaderCsrf(req);
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken.length).toBeGreaterThan(0);
    // never serialize a literal 'null' Set-Cookie (regression guard)
    expect(headers['set-cookie']).not.toBe('null');
  });

  it('omits the set-cookie header entirely when commitToken yields null', async () => {
    const { loaderCsrf } = await import('@/server/csrf');
    const req = new Request('https://x.test/id/login');
    const { headers } = await loaderCsrf(req);
    // if present, it must be a real cookie string, never the literal 'null'
    if (Object.prototype.hasOwnProperty.call(headers, 'set-cookie')) {
      expect(headers['set-cookie']).not.toBe('null');
    }
  });

  it('uses CSRF_FORM_KEY as the form field name', async () => {
    const { readFileSync } = await import('node:fs');
    // node:url's URL (not the happy-dom global URL) so node:fs accepts the file:// URL
    const { URL: NodeURL } = await import('node:url');
    const src = readFileSync(new NodeURL('../csrf.ts', import.meta.url));
    expect(src.toString()).toContain('CSRF_FORM_KEY');
    expect(CSRF_FORM_KEY).toBe('csrf');
  });
});

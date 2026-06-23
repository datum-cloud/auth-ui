// app/server/__tests__/user-agent.test.ts
// @vitest-environment node
//
// Unit tests for userAgentFromRequest — the util that builds the Zitadel
// UserAgent shape from a Web Request. Runs in node (not happy-dom) so that
// standard undici Request header handling is used without browser restrictions.
//
// Covered:
//   1. UA header → header['user-agent'].values is a SINGLE raw-UA value
//   2. x-forwarded-for last-hop IP precedence (same proxy-trust model as rate-limit.ts)
//   3. description is the raw UA string (Bowser parses browser/OS from it downstream)
//   4. fingerprintId: explicit param, fingerprintId cookie fallback, param overrides cookie
//   5. Empty fields are omitted (no UA → no header key; no XFF → no ip key)
import { userAgentFromRequest } from '../user-agent';
import { describe, it, expect } from 'vitest';

// Representative desktop Chrome UA used across tests.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/id/login', { headers });
}

describe('userAgentFromRequest', () => {
  // ── UA header ──────────────────────────────────────────────────────────────

  it('maps user-agent header to header["user-agent"].values as a single raw-UA value', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    expect(result.header).toBeDefined();
    // 755-M2: a SINGLE full-UA value — NOT comma-split. Splitting fragments the UA
    // at its internal `(KHTML, like Gecko)` comma and gives Bowser nothing parseable.
    expect(result.header!['user-agent']).toEqual({ values: [CHROME_UA] });
  });

  it('omits header field when user-agent is absent', () => {
    const req = makeRequest({});
    const result = userAgentFromRequest(req);
    expect(result.header).toBeUndefined();
  });

  // ── IP extraction ──────────────────────────────────────────────────────────

  it('takes the last hop from x-forwarded-for (gateway-appended)', () => {
    // The rate-limit middleware takes .at(-1) — the last entry — which is appended
    // by the trusted gateway (Envoy/nginx). We must use the same model.
    const req = makeRequest({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
      'user-agent': CHROME_UA,
    });
    const result = userAgentFromRequest(req);
    expect(result.ip).toBe('9.10.11.12');
  });

  it('uses single-entry x-forwarded-for directly', () => {
    const req = makeRequest({
      'x-forwarded-for': '203.0.113.5',
      'user-agent': CHROME_UA,
    });
    const result = userAgentFromRequest(req);
    expect(result.ip).toBe('203.0.113.5');
  });

  it('omits ip field when x-forwarded-for is absent', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    expect(result.ip).toBeUndefined();
  });

  // ── description (raw UA) ─────────────────────────────────────────────────────

  it('uses the raw UA string as the description (Bowser parses OS/browser from it)', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    // 755-M2: description is the verbatim UA — milo's gateway runs Bowser over
    // whichever field maps to status.userAgent, and Bowser needs the raw UA tokens
    // (e.g. `Macintosh`) to resolve the OS that previously came back null.
    expect(result.description).toBe(CHROME_UA);
  });

  it('description retains the raw OS tokens Bowser needs (Macintosh / Mac OS X)', () => {
    const desc = userAgentFromRequest(makeRequest({ 'user-agent': CHROME_UA })).description!;
    expect(desc).toContain('Macintosh');
    expect(desc).toContain('Mac OS X');
  });

  it('description is the raw UA for a mobile UA too', () => {
    const IPHONE_UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const desc = userAgentFromRequest(makeRequest({ 'user-agent': IPHONE_UA })).description!;
    expect(desc).toBe(IPHONE_UA);
  });

  it('attaches a description whenever a user-agent header is present', () => {
    const result = userAgentFromRequest(makeRequest({ 'user-agent': 'curl/8.4.0' }));
    expect(result.description).toBe('curl/8.4.0');
  });

  it('omits description field when user-agent is absent', () => {
    const req = makeRequest({});
    const result = userAgentFromRequest(req);
    expect(result.description).toBeUndefined();
  });

  // ── fingerprintId (param + cookie) ───────────────────────────────────────────

  it('passes an explicit fingerprintId param through to the result', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req, 'fp-abc-123');
    expect(result.fingerprintId).toBe('fp-abc-123');
  });

  it('reads fingerprintId from the fingerprintId cookie when no param is given', () => {
    const req = makeRequest({
      'user-agent': CHROME_UA,
      cookie: 'foo=bar; fingerprintId=bbd33da2-1234-5678; baz=qux',
    });
    const result = userAgentFromRequest(req);
    expect(result.fingerprintId).toBe('bbd33da2-1234-5678');
  });

  it('decodes a URL-encoded fingerprintId cookie value', () => {
    const req = makeRequest({
      'user-agent': CHROME_UA,
      cookie: 'fingerprintId=abc%20def',
    });
    const result = userAgentFromRequest(req);
    expect(result.fingerprintId).toBe('abc def');
  });

  it('lets an explicit fingerprintId param override the cookie', () => {
    const req = makeRequest({
      'user-agent': CHROME_UA,
      cookie: 'fingerprintId=cookie-value',
    });
    const result = userAgentFromRequest(req, 'param-value');
    expect(result.fingerprintId).toBe('param-value');
  });

  it('omits fingerprintId when neither a param nor a cookie is provided', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    expect(result.fingerprintId).toBeUndefined();
  });

  it('omits fingerprintId when the cookie header has no fingerprintId entry', () => {
    const req = makeRequest({
      'user-agent': CHROME_UA,
      cookie: 'foo=bar; baz=qux',
    });
    const result = userAgentFromRequest(req);
    expect(result.fingerprintId).toBeUndefined();
  });

  // ── shape completeness ─────────────────────────────────────────────────────

  it('returns all fields when all inputs are present', () => {
    const req = makeRequest({
      'user-agent': CHROME_UA,
      'x-forwarded-for': '10.0.0.1, 203.0.113.99',
    });
    const result = userAgentFromRequest(req, 'fp-xyz');
    expect(result).toMatchObject({
      fingerprintId: 'fp-xyz',
      ip: '203.0.113.99',
      description: CHROME_UA,
      header: { 'user-agent': { values: [CHROME_UA] } },
    });
  });

  it('returns empty object when no headers and no fingerprintId', () => {
    const req = makeRequest({});
    const result = userAgentFromRequest(req);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// app/server/__tests__/user-agent.test.ts
// @vitest-environment node
//
// Unit tests for userAgentFromRequest — the util that builds the Zitadel
// UserAgent shape from a Web Request. Runs in node (not happy-dom) so that
// standard undici Request header handling is used without browser restrictions.
//
// Covered:
//   1. UA header → header['user-agent'].values array
//   2. x-forwarded-for last-hop IP precedence (same proxy-trust model as rate-limit.ts)
//   3. description parsed from a representative UA string
//   4. fingerprintId passthrough
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

  it('maps user-agent header to header["user-agent"].values (OLD comma-split shape)', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    expect(result.header).toBeDefined();
    // 755-M1: byte-match the OLD payload — the raw UA is comma-split (the field the
    // cloud-portal session gateway parses), NOT a single-element array.
    expect(result.header!['user-agent']).toEqual({ values: CHROME_UA.split(',') });
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

  // ── description parsing ────────────────────────────────────────────────────

  it('produces a non-empty description from a representative Chrome UA', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    expect(result.description).toBeDefined();
    expect(typeof result.description).toBe('string');
    expect(result.description!.length).toBeGreaterThan(0);
  });

  it('description includes browser name for Chrome UA', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    // The old getUserAgent() builder embeds browser.name in description.
    expect(result.description).toMatch(/chrome/i);
  });

  it('description includes OS name for macOS UA', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req);
    // macOS should appear somewhere in the parsed OS segment.
    expect(result.description).toMatch(/mac/i);
  });

  // ── 755-M1: byte-match the OLD auth-ui payload (cloud-portal session gateway parses it) ──

  it('description uses the OLD comma-group format with OS preserved (not the " · " cleanup)', () => {
    const desc = userAgentFromRequest(makeRequest({ 'user-agent': CHROME_UA })).description!;
    // OLD lib/fingerprint.ts: four comma-joined "name, version, " groups (browser/device/engine/OS),
    // empty segments preserved. OS ("macOS, 10.15.7") MUST be present for the portal's OS column.
    expect(desc).toContain('Chrome,');
    expect(desc).toContain('Blink,');
    expect(desc).toContain('macOS,');
    expect(desc).toContain('10.15.7,');
    expect(desc).toMatch(/,/); // comma-separated (OLD shape)
    expect(desc).not.toContain(' · '); // NOT the " · " cleanup that regressed the gateway
  });

  it('mobile UA includes the device + OS segments (OLD format)', () => {
    const IPHONE_UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const desc = userAgentFromRequest(makeRequest({ 'user-agent': IPHONE_UA })).description!;
    expect(desc).toMatch(/Safari/);
    expect(desc).toMatch(/iPhone/);
    expect(desc).toMatch(/iOS, 17\.0/); // OLD format: "iOS, 17.0" (comma between name and version)
  });

  it('attaches a description whenever a user-agent header is present (OLD always emitted one)', () => {
    // The OLD format always returns a (possibly empty-ish) string when a UA header is present.
    const result = userAgentFromRequest(makeRequest({ 'user-agent': 'curl/8.4.0' }));
    expect(result.description).toBeDefined();
    expect(typeof result.description).toBe('string');
  });

  it('omits description field when user-agent is absent', () => {
    const req = makeRequest({});
    const result = userAgentFromRequest(req);
    expect(result.description).toBeUndefined();
  });

  // ── fingerprintId passthrough ──────────────────────────────────────────────

  it('passes fingerprintId through to the result', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
    const result = userAgentFromRequest(req, 'fp-abc-123');
    expect(result.fingerprintId).toBe('fp-abc-123');
  });

  it('omits fingerprintId when not provided', () => {
    const req = makeRequest({ 'user-agent': CHROME_UA });
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
      header: { 'user-agent': { values: CHROME_UA.split(',') } },
    });
    expect(result.description).toBeDefined();
  });

  it('returns empty object when no headers and no fingerprintId', () => {
    const req = makeRequest({});
    const result = userAgentFromRequest(req);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

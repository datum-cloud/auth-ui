// cypress/component/shared/custom-request-headers.cy.ts
//
// Pure parser for ZITADEL_CUSTOM_REQUEST_HEADERS (browser-side Chai, no mount). The env schema
// and the Zitadel transport both call this, so these rows pin the format for both.
import { parseCustomRequestHeaders } from '@/shared/custom-request-headers';

describe('parseCustomRequestHeaders', () => {
  // REGRESSION: `header.split(':')` kept only the text between the first and second ':',
  // so `x-public-url:https://auth.example.test:8443` was sent as `https`.
  it("keeps a value that contains ':' whole by splitting on the first ':' only", () => {
    expect(
      parseCustomRequestHeaders('x-public-url:https://auth.example.test:8443/path')
    ).to.deep.equal({
      headers: [['x-public-url', 'https://auth.example.test:8443/path']],
      malformed: [],
    });
  });

  it('parses multiple headers in order, trims whitespace, and ignores blank entries', () => {
    expect(
      parseCustomRequestHeaders(
        ' x-zitadel-public-host : auth.example.test:443 ,x-zitadel-public-proto:https,, '
      )
    ).to.deep.equal({
      headers: [
        ['x-zitadel-public-host', 'auth.example.test:443'],
        ['x-zitadel-public-proto', 'https'],
      ],
      malformed: [],
    });
  });

  it('returns no headers for an unset or empty value', () => {
    for (const raw of [undefined, '', ' , ']) {
      expect(parseCustomRequestHeaders(raw), String(raw)).to.deep.equal({
        headers: [],
        malformed: [],
      });
    }
  });

  it('reports a malformed entry instead of dropping it, and still parses the valid ones', () => {
    const MALFORMED: [label: string, entry: string][] = [
      ['no separator', 'x-no-separator'],
      ['empty name', ':value'],
      ['empty value', 'x-empty:'],
      ['name with a space', 'bad name:value'],
      ['control character in the value', 'x-inject:a\r\nx-evil:1'],
    ];
    for (const [label, entry] of MALFORMED) {
      const parsed = parseCustomRequestHeaders(`x-ok:1,${entry}`);
      expect(parsed.headers, label).to.deep.equal([['x-ok', '1']]);
      expect(parsed.malformed, label).to.deep.equal([entry.trim()]);
    }
  });
});

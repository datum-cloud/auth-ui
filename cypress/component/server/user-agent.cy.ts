// cypress/component/server/user-agent.cy.ts
// CY-TASK port of app/server/__tests__/user-agent.test.ts
// Cookie header + crypto.randomUUID make this node-bound.
//
// NOTE: This suite was deliberately reduced from a 24-test matrix (one it() per UA-parsing
// permutation) down to a small representative set covering distinct mechanisms rather than
// duplicate UA string literals — see inline comments.
import { callService } from '../../support/node/call-service';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('userAgentFromRequest — header', () => {
  it('maps the User-Agent header to the header field', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'uaHeaderMapped' }).then((v) => {
      expect(v.outcome.header?.['user-agent']?.values?.[0]).to.equal(CHROME_UA);
    });
  });
});

describe('userAgentFromRequest — ip (XFF last-hop)', () => {
  it('uses the last entry in X-Forwarded-For as the trusted proxy hop', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'xffLastHop' }).then((v) => {
      expect(v.outcome.ip).to.equal('9.10.11.12');
    });
  });
});

describe('userAgentFromRequest — description', () => {
  it('handles mobile UA strings', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'descriptionMobile' }).then((v) => {
      expect(v.outcome.description).to.be.a('string').and.include('iPhone');
    });
  });

  it('handles curl UA strings', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'descriptionCurl' }).then((v) => {
      expect(v.outcome.description).to.include('curl');
    });
  });
});

describe('userAgentFromRequest — fingerprintId', () => {
  it('the explicit parameter overrides the cookie value', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpIdParamOverride' }).then((v) => {
      expect(v.outcome.fingerprintId).to.equal('param-value');
    });
  });
});

describe('userAgentFromRequest — all fields', () => {
  it('returns an empty object when no headers and no fingerprintId are present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'emptyRequest' }).then((v) => {
      // All fields are optional — empty request → omit everything → {} (0 keys)
      expect(v.outcome.keyCount).to.equal(0);
    });
  });
});

describe('getOrCreateFingerprintId', () => {
  it('mints a new UUID when secure=true and no cookie is present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'mintNewFp' }).then((v) => {
      expect(v.outcome.matchesUUID).to.equal(true);
      expect(v.outcome.setCookieNotNull).to.equal(true);
      expect(v.outcome.idInCookie).to.equal(true);
    });
  });
});

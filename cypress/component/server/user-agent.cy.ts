// cypress/component/server/user-agent.cy.ts
// CY-TASK port of app/server/__tests__/user-agent.test.ts
// Cookie header + crypto.randomUUID make this node-bound.
import { callService } from '../../support/node/call-service';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('userAgentFromRequest — header', () => {
  it('maps the User-Agent header to the header field', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'uaHeaderMapped' }).then((v) => {
      expect(v.outcome.header?.['user-agent']?.values?.[0]).to.equal(CHROME_UA);
    });
  });

  it('returns undefined header when no User-Agent is present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'noUaHeader' }).then((v) => {
      expect(v.outcome.headerDefined).to.equal(false);
    });
  });
});

describe('userAgentFromRequest — ip (XFF last-hop)', () => {
  it('uses the last entry in X-Forwarded-For as the trusted proxy hop', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'xffLastHop' }).then((v) => {
      expect(v.outcome.ip).to.equal('9.10.11.12');
    });
  });

  it('handles a single XFF value', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'singleXff' }).then((v) => {
      expect(v.outcome.ip).to.equal('203.0.113.5');
    });
  });

  it('returns undefined ip when XFF header is absent', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'noXff' }).then((v) => {
      expect(v.outcome.ipDefined).to.equal(false);
    });
  });
});

describe('userAgentFromRequest — description', () => {
  it('returns the raw UA string as description', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'descriptionRaw' }).then((v) => {
      expect(v.outcome.description).to.equal(CHROME_UA);
    });
  });

  it('description contains OS tokens from the UA', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'descriptionTokens' }).then((v) => {
      expect(v.outcome.hasMacintosh).to.equal(true);
      expect(v.outcome.hasMacOsX).to.equal(true);
    });
  });

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

  it('returns undefined description when no UA header is present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'noDescription' }).then((v) => {
      expect(v.outcome.descriptionDefined).to.equal(false);
    });
  });
});

describe('userAgentFromRequest — fingerprintId', () => {
  it('uses an explicit fingerprintId parameter when provided', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'explicitFpId' }).then((v) => {
      expect(v.outcome.fingerprintId).to.equal('fp-abc-123');
    });
  });

  it('reads fingerprintId from the cookie when no explicit value is given', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpIdFromCookie' }).then((v) => {
      expect(v.outcome.fingerprintId).to.equal('bbd33da2-1234-5678');
    });
  });

  it('URL-decodes the fingerprintId cookie value', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'urlEncodedFpId' }).then((v) => {
      expect(v.outcome.fingerprintId).to.equal('abc def');
    });
  });

  it('the explicit parameter overrides the cookie value', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpIdParamOverride' }).then((v) => {
      expect(v.outcome.fingerprintId).to.equal('param-value');
    });
  });

  it('returns undefined fingerprintId when absent', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'noFpId' }).then((v) => {
      expect(v.outcome.fingerprintIdDefined).to.equal(false);
    });
  });

  it('returns undefined fingerprintId when cookie is present but has no fingerprintId key', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'noFpIdCookie' }).then((v) => {
      expect(v.outcome.fingerprintIdDefined).to.equal(false);
    });
  });
});

describe('userAgentFromRequest — all fields', () => {
  it('populates header, ip, description, and fingerprintId together', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'allFields' }).then((v) => {
      expect(v.outcome.result.header?.['user-agent']?.values?.[0]).to.equal(CHROME_UA);
      expect(v.outcome.result.ip).to.equal('203.0.113.99');
      expect(v.outcome.result.description).to.be.a('string');
      expect(v.outcome.result.fingerprintId).to.equal('fp-xyz');
    });
  });

  it('returns an empty object when no headers and no fingerprintId are present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'emptyRequest' }).then((v) => {
      // All fields are optional — empty request → omit everything → {} (0 keys)
      expect(v.outcome.keyCount).to.equal(0);
    });
  });
});

describe('getOrCreateFingerprintId', () => {
  it('reuses the existing cookie value and returns null for set-cookie', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'reuseExistingFp' }).then((v) => {
      expect(v.outcome.id).to.equal('existing-fp-123');
      expect(v.outcome.setCookieIsNull).to.equal(true);
    });
  });

  it('mints a new UUID when secure=true and no cookie is present', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'mintNewFp' }).then((v) => {
      expect(v.outcome.matchesUUID).to.equal(true);
      expect(v.outcome.setCookieNotNull).to.equal(true);
      expect(v.outcome.idInCookie).to.equal(true);
    });
  });

  it('sets expected cookie attributes', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpCookieAttrs' }).then((v) => {
      expect(v.outcome.maxAge).to.equal(true);
      expect(v.outcome.path).to.equal(true);
      expect(v.outcome.httpOnly).to.equal(true);
      expect(v.outcome.sameSite).to.equal(true);
    });
  });

  it('includes Secure flag when secure=true, omits it when secure=false', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpSecureFlag' }).then((v) => {
      expect(v.outcome.trueHasSecure).to.equal(true);
      expect(v.outcome.falseNoSecure).to.equal(true);
    });
  });

  it('mints distinct UUIDs on successive calls', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpDistinctMints' }).then((v) => {
      expect(v.outcome.distinct).to.equal(true);
    });
  });

  it('round-trips: minted id equals what userAgentFromRequest reads from the header', () => {
    callService({ fn: 'userAgentCheck', userAgentOp: 'fpRoundTrip' }).then((v) => {
      expect(v.outcome.fingerprintId).to.be.a('string').and.have.length.greaterThan(0);
    });
  });
});

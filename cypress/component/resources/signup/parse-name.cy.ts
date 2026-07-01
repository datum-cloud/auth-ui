// cypress/component/resources/signup/parse-name.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/parse-name.test.ts.
// Pure string utility → browser-side Chai only.
import { parseNameFromEmail } from '@/resources/signup/parse-name';

describe('parseNameFromEmail', () => {
  it('parses first/last name from dotted, tagged, single-token, and multi-segment local parts', () => {
    expect(parseNameFromEmail('john.doe@example.com')).to.deep.equal({
      firstName: 'John',
      lastName: 'Doe',
    });
    expect(parseNameFromEmail('john_doe+ml@example.com')).to.deep.equal({
      firstName: 'John',
      lastName: 'Doe',
    });
    expect(parseNameFromEmail('jdoe@example.com')).to.deep.equal({
      firstName: 'Jdoe',
      lastName: 'Jdoe',
    });
    expect(parseNameFromEmail('mary.jane.watson@x.com')).to.deep.equal({
      firstName: 'Mary',
      lastName: 'Jane Watson',
    });
  });
});

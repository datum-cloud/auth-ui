// cypress/component/resources/signup/parse-name.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/parse-name.test.ts.
// Pure string utility → browser-side Chai only.
import { parseNameFromEmail } from '@/resources/signup/parse-name';

describe('parseNameFromEmail', () => {
  it('splits a dotted local part into first/last', () => {
    expect(parseNameFromEmail('john.doe@example.com')).to.deep.equal({
      firstName: 'John',
      lastName: 'Doe',
    });
  });
  it('strips +tag and splits on underscore', () => {
    expect(parseNameFromEmail('john_doe+ml@example.com')).to.deep.equal({
      firstName: 'John',
      lastName: 'Doe',
    });
  });
  it('duplicates a single-token local part', () => {
    expect(parseNameFromEmail('jdoe@example.com')).to.deep.equal({
      firstName: 'Jdoe',
      lastName: 'Jdoe',
    });
  });
  it('handles a one-character local part', () => {
    expect(parseNameFromEmail('a@example.com')).to.deep.equal({ firstName: 'A', lastName: 'A' });
  });
  it('joins 3+ segments into the last name', () => {
    expect(parseNameFromEmail('mary.jane.watson@x.com')).to.deep.equal({
      firstName: 'Mary',
      lastName: 'Jane Watson',
    });
  });
  it('never returns an empty given/family name', () => {
    const r = parseNameFromEmail('---@x.com');
    expect(r.firstName.length).to.be.greaterThan(0);
    expect(r.lastName.length).to.be.greaterThan(0);
  });
});

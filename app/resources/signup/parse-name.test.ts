import { describe, it, expect } from 'vitest';
import { parseNameFromEmail } from './parse-name';

describe('parseNameFromEmail', () => {
  it('splits a dotted local part into first/last', () => {
    expect(parseNameFromEmail('john.doe@example.com')).toEqual({ firstName: 'John', lastName: 'Doe' });
  });
  it('strips +tag and splits on underscore', () => {
    expect(parseNameFromEmail('john_doe+ml@example.com')).toEqual({ firstName: 'John', lastName: 'Doe' });
  });
  it('duplicates a single-token local part', () => {
    expect(parseNameFromEmail('jdoe@example.com')).toEqual({ firstName: 'Jdoe', lastName: 'Jdoe' });
  });
  it('handles a one-character local part', () => {
    expect(parseNameFromEmail('a@example.com')).toEqual({ firstName: 'A', lastName: 'A' });
  });
  it('joins 3+ segments into the last name', () => {
    expect(parseNameFromEmail('mary.jane.watson@x.com')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' });
  });
  it('never returns an empty given/family name', () => {
    const r = parseNameFromEmail('---@x.com');
    expect(r.firstName.length).toBeGreaterThan(0);
    expect(r.lastName.length).toBeGreaterThan(0);
  });
});

import { userCodeSchema } from '@/resources/schemas/user-code';

describe('userCodeSchema', () => {
  // Shape and length rules. The query-injection case is deliberately NOT in this table —
  // it is the security guard and stays standalone below so it fails on its own.
  const CASES: [label: string, input: string | undefined, accepted: boolean][] = [
    ['OAuth device user_code shape', 'WDJB-MJHT', true],
    ['underscores', 'WDJB_MJHT', true],
    ['over 64 characters', 'A'.repeat(65), false],
    ['absence is valid (optional)', undefined, true],
  ];

  it('accepts the OAuth device user_code shape (dashes, underscores, absent) and rejects over-length values', () => {
    for (const [label, input, accepted] of CASES) {
      expect(userCodeSchema.safeParse(input).success, label).to.equal(accepted);
    }

    // Absence must parse to undefined, not to a coerced empty string.
    const absent = userCodeSchema.safeParse(undefined);
    expect(absent.success && absent.data).to.equal(undefined);
  });

  it('rejects query-injection characters — SECURITY', () => {
    expect(userCodeSchema.safeParse('X&loginName=admin').success).to.be.false;
  });
});

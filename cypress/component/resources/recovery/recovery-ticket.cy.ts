// cypress/component/resources/recovery/recovery-ticket.cy.ts
//
// CY-TASK: recovery-ticket.server.ts uses node:crypto (AES-256-GCM + HKDF) and reads
// env.SESSION_SECRET, so the REAL module runs node-side via cy.task.
//
// The ticket is what makes the typed-code path possible without a session, and its FIXED LENGTH
// is what makes G7 hold: every /recover POST sets a ticket cookie, real or filler, and the two
// must be indistinguishable byte-for-byte in length. These assertions are the enforcement point
// for that — a format change that makes filler and real diverge fails here, not in production
// as an enumeration oracle.
import { callService } from '../../../support/node/call-service';

const ops = [
  'roundTrip',
  'fillerLength',
  'wrongEmail',
  'tampered',
  'expired',
  'ceremonyRoundTrip',
  'fillerOpensNull',
  'kindConfusion',
  'idTooLong',
] as const;

describe('recovery tickets — sealed, fixed-length, bound to the address', () => {
  it('holds every ticket property in one node round-trip', () => {
    callService({ fn: 'recoveryTicketCheck', ticketOps: [...ops] }).then((v) => {
      const o = v.outcome as Record<string, never>;

      // A sealed request ticket opens with the SAME address to the ids it carries — and only
      // the ids: the code itself is never in the ticket.
      expect(o.roundTrip).to.deep.equal({ userId: 'u-1', codeId: 'code-id-1' });

      // G7: filler and real are the same length, and two fillers differ (a constant filler
      // would be recognisable on the wire even at equal length).
      expect(o.fillerLength).to.deep.equal({ sameLength: true, fillersDiffer: true });

      // Bound to hash(email): a ticket issued for one address cannot authorise another.
      expect(o.wrongEmail, 'a ticket from another address must not open').to.equal(null);

      // AES-GCM authentication tag: one flipped character is a forgery, not a decode.
      expect(o.tampered, 'a tampered ticket must not open').to.equal(null);

      // Expiry rides inside the sealed plaintext, so it cannot be extended by the client.
      expect(o.expired, 'an expired ticket must not open').to.equal(null);

      expect(o.ceremonyRoundTrip).to.deep.equal({ userId: 'u-1', passkeyId: 'pk-1' });

      // A filler carries random bytes in the id fields; it must never open as a real ticket.
      expect(o.fillerOpensNull, 'a filler must open to null').to.equal(null);

      // The kind byte keeps the two ticket types apart: a request ticket presented as a
      // ceremony ticket (or the reverse) is refused, so the code-consuming step cannot be
      // skipped by replaying the cookie the request step set.
      expect(o.kindConfusion).to.deep.equal({ requestAsCeremony: null, ceremonyAsRequest: null });

      // An oversized id would break the fixed-length invariant. Sealing degrades to a filler
      // and audits, rather than throwing — a throw inside the /recover action would change the
      // response shape and become the enumeration oracle the fixed length exists to prevent.
      expect(o.idTooLong).to.deep.equal({ sameLength: true, opens: null });
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_ticket');
      expect(audit).to.contain('id_too_long');
    });
  });
});

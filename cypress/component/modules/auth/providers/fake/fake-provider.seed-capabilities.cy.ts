// cypress/component/modules/auth/providers/fake/fake-provider.seed-capabilities.cy.ts
//
// Component (no-mount) merge of three former single-test specs, all of which were trivial
// seed/flag/opts pass-through checks on the SAME test double:
//   • fake-provider.domain-discovery.cy.ts — findOrgByDomain against the orgDomains seed
//   • fake-provider.email-verify.cy.ts     — register(emailVerified) + markEmailVerified
//   • fake-provider.user-agent.cy.ts       — userAgent forwarding onto lastCreateSessionOpts
//
// NOTE: this exercises a FAKE provider (test double / harness), not production security logic.
// Every assertion from all three files is preserved verbatim; each group constructs its own
// provider instances, so merging them into one `it` introduces no shared state between groups.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';

describe('FakeAuthProvider — seed-driven capabilities', () => {
  it('resolves seeded org domains, honors emailVerified, and forwards userAgent to createSession', async () => {
    // findOrgByDomain: seeded hit, unknown miss, and unseeded provider miss.
    const domains = new FakeAuthProvider({ orgDomains: { 'acme.test': 'org-acme' } });
    expect(await domains.findOrgByDomain('acme.test')).to.deep.equal({ orgId: 'org-acme' });
    expect(await domains.findOrgByDomain('unknown.test')).to.be.null;
    expect(await new FakeAuthProvider().findOrgByDomain('acme.test')).to.be.null;

    // register(emailVerified): true marks immediately, omitted leaves it unverified.
    const registrar = new FakeAuthProvider();
    const verified = await registrar.register({
      email: 'pre-verified@acme.test',
      firstName: 'Pre',
      lastName: 'Verified',
      emailVerified: true,
    });
    expect(registrar.isEmailVerified(verified.id)).to.equal(true);

    const unverified = await registrar.register({
      email: 'unverified@acme.test',
      firstName: 'Un',
      lastName: 'Verified',
    });
    expect(registrar.isEmailVerified(unverified.id)).to.equal(false);

    // markEmailVerified: marks idempotently, without an email arg.
    const seeded = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'mark@acme.test', displayName: 'Mark' }],
    });
    expect(seeded.isEmailVerified('u1')).to.equal(false);
    await seeded.markEmailVerified('u1');
    await seeded.markEmailVerified('u1'); // idempotent
    expect(seeded.isEmailVerified('u1')).to.equal(true);

    // userAgent forwarding: full object, omitted, and partial.
    const full = new FakeAuthProvider();
    const ua = {
      fingerprintId: 'fp-abc',
      ip: '1.2.3.4',
      description: 'Chrome 124 · Blink 537.36 · macOS 10.15',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    await full.createSession({}, { userAgent: ua });
    expect(full.lastCreateSessionOpts?.userAgent).to.deep.equal(ua);

    const omitted = new FakeAuthProvider();
    await omitted.createSession({});
    expect(omitted.lastCreateSessionOpts?.userAgent).to.be.undefined;

    const partial = new FakeAuthProvider();
    await partial.createSession({}, { userAgent: { fingerprintId: 'fp-only' } });
    expect(partial.lastCreateSessionOpts?.userAgent).to.deep.equal({ fingerprintId: 'fp-only' });
  });
});

// Task A: register(emailVerified) + code-based markEmailVerified
// These tests run against the fake provider and confirm:
//   1. register({ emailVerified: true }) immediately marks the user's email verified.
//   2. markEmailVerified(userId) — no email arg — marks the user verified.
//   3. Both signatures are observable via isEmailVerified().
import { FakeAuthProvider } from '../fake-provider';
import { describe, it, expect } from 'vitest';

describe('FakeAuthProvider — register emailVerified (Task A Step 1)', () => {
  it('register with emailVerified:true leaves the email verified immediately', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'pre-verified@acme.test',
      firstName: 'Pre',
      lastName: 'Verified',
      emailVerified: true,
    });
    expect(p.isEmailVerified(user.id)).toBe(true);
  });

  it('register without emailVerified leaves the email unverified (existing behaviour)', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'unverified@acme.test',
      firstName: 'Un',
      lastName: 'Verified',
    });
    expect(p.isEmailVerified(user.id)).toBe(false);
  });

  it('register with emailVerified:false leaves the email unverified', async () => {
    const p = new FakeAuthProvider();
    const user = await p.register({
      email: 'explicit-false@acme.test',
      firstName: 'Explicit',
      lastName: 'False',
      emailVerified: false,
    });
    expect(p.isEmailVerified(user.id)).toBe(false);
  });
});

describe('FakeAuthProvider — markEmailVerified(userId) no email arg (Task A Step 2)', () => {
  it('markEmailVerified(userId) marks the user verified without an email argument', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'mark@acme.test', displayName: 'Mark' }],
    });
    expect(p.isEmailVerified('u1')).toBe(false);
    await p.markEmailVerified('u1');
    expect(p.isEmailVerified('u1')).toBe(true);
  });

  it('markEmailVerified is idempotent when called twice', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u2', loginName: 'idem@acme.test', displayName: 'Idem' }],
    });
    await p.markEmailVerified('u2');
    await p.markEmailVerified('u2');
    expect(p.isEmailVerified('u2')).toBe(true);
  });
});

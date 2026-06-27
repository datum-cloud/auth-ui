import { deviceDecision } from '@/resources/device/device-decision';

const session = { id: 'sess-1', token: 'tok-1' };

describe('deviceDecision', () => {
  it('authorize with a session returns a {session} decision', () => {
    expect(deviceDecision({ decision: 'authorize', session })).to.deep.equal({ session });
  });
  it('deny ignores any session and returns an empty decision', () => {
    expect(deviceDecision({ decision: 'deny', session })).to.deep.equal({});
  });
  it('deny without a session also returns an empty decision', () => {
    expect(deviceDecision({ decision: 'deny' })).to.deep.equal({});
  });
  it('authorize without a session throws (cannot authorize unauthenticated)', () => {
    expect(() => deviceDecision({ decision: 'authorize' })).to.throw('session required');
  });
});

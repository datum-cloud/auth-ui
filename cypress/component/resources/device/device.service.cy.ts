// cypress/component/resources/device/device.service.cy.ts
//
// cy.task node-spec port of app/resources/device/__tests__/device.service.test.ts. The decision
// action reads a signed `sessions` cookie to gate authorize on a live session, so it is node-bound.
// Each cy.task call is its own fresh Bun process, so the rich singleton seed (dev-1 / dev-deny /
// dev-authorize / WDJB-MJHT) is clean per case — no cross-test state bleed.
import { callService } from '../../../support/node/call-service';

describe('lookupDeviceCode (/device action)', () => {
  it('valid user code → redirect to /device/authorize with requestId and user_code', () => {
    callService({
      fn: 'lookupDeviceCode',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device', form: { userCode: 'WDJB-MJHT' } },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('/device/authorize');
      expect(o.location).to.include('requestId=device_WDJB-MJHT');
      expect(o.location).to.include('user_code=WDJB-MJHT');
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('/device/authorize');
    });
  });
});

describe('resolveDeviceDecision (/device/authorize action)', () => {
  it('authorize WITHOUT a session → redirect to /login with requestId', () => {
    callService({
      fn: 'resolveDeviceDecision',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        form: { decision: 'authorize', deviceAuthId: 'dev-1', requestId: 'device_WDJB-MJHT' },
      },
    }).then((v) => {
      const o = v.outcome as { kind: string };
      expect(o.kind).to.equal('redirect');
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=device_WDJB-MJHT');
    });
  });
});

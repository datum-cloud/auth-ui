// cypress/component/resources/device/device.service.cy.ts
//
// cy.task node-spec port of app/resources/device/__tests__/device.service.test.ts. The decision
// action reads a signed `sessions` cookie to gate authorize on a live session, so it is node-bound.
// Each cy.task call is its own fresh Bun process, so the rich singleton seed (dev-1 / dev-deny /
// dev-authorize / WDJB-MJHT) is clean per case — no cross-test state bleed.
import { callService } from '../../../support/node/call-service';

const SESSION = [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }];

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

  it('unknown user code → not a redirect; not_found error with status 404', () => {
    callService({
      fn: 'lookupDeviceCode',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device', form: { userCode: 'NOPE' } },
    }).then((v) => {
      const o = v.outcome as { kind: string; error?: string; status?: number };
      expect(o.kind).to.equal('error');
      expect(o.error).to.equal('not_found');
      expect(o.status).to.equal(404);
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(404);
      expect((v.response?.dataBody as { error?: string })?.error).to.equal('not_found');
    });
  });

  it('missing user code → invalid_code error with status 400', () => {
    callService({
      fn: 'lookupDeviceCode',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device', form: {} },
    }).then((v) => {
      const o = v.outcome as { kind: string; error?: string; status?: number };
      expect(o.kind).to.equal('error');
      expect(o.error).to.equal('invalid_code');
      expect(o.status).to.equal(400);
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect((v.response?.dataBody as { error?: string })?.error).to.equal('invalid_code');
    });
  });
});

describe('loadDeviceConsent (/device/authorize loader)', () => {
  it('builds requestId from the STABLE user code (device_<userCode>), not the device-auth id', () => {
    callService({
      fn: 'loadDeviceConsent',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize?user_code=WDJB-MJHT' },
    }).then((v) => {
      const o = v.outcome as {
        kind: string;
        consent?: { requestId: string; deviceAuthId: string };
      };
      expect(o.kind).to.equal('consent');
      expect(o.consent?.requestId).to.equal('device_WDJB-MJHT');
      expect(o.consent?.deviceAuthId).to.equal('dev-1');
    });
  });

  it('missing user_code → 302 redirect to /device (contextless redirect half)', () => {
    callService({
      fn: 'loadDeviceConsent',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize' },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/device');
    });
  });

  it('unknown user_code → recovery error; toResponse keeps the existing friendly 404', () => {
    callService({
      fn: 'loadDeviceConsent',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize?user_code=NOPE' },
    }).then((v) => {
      const o = v.outcome as { kind: string; error?: { recovery?: string; status?: number } };
      expect(o.kind).to.equal('error');
      expect(o.error?.recovery).to.equal('device');
      expect(o.error?.status).to.equal(404);
      expect(v.response?.dataStatus).to.equal(404);
    });
  });
});

describe('resolveDeviceDecision (/device/authorize action)', () => {
  it('authorize with a session → device is authorized; redirects to the terminal /device/complete', () => {
    callService({
      fn: 'resolveDeviceDecision',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        sessions: SESSION,
        form: {
          decision: 'authorize',
          deviceAuthId: 'dev-authorize',
          requestId: 'device_dev-authorize',
        },
      },
      inspect: { isDeviceAuthorized: ['dev-authorize'] },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/device/complete?decision=authorize');
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/device/complete?decision=authorize');
      expect((v.inspect?.isDeviceAuthorized as Record<string, boolean>)['dev-authorize']).to.equal(
        true
      );
    });
  });

  it('a dedicated authorize-only device id isolates state from other tests', () => {
    callService({
      fn: 'resolveDeviceDecision',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        sessions: SESSION,
        form: {
          decision: 'authorize',
          deviceAuthId: 'dev-authorize',
          requestId: 'device_dev-authorize',
        },
      },
      inspect: { isDeviceAuthorized: ['dev-authorize', 'dev-1'] },
    }).then((v) => {
      const authd = v.inspect?.isDeviceAuthorized as Record<string, boolean>;
      expect(authd['dev-authorize']).to.equal(true);
      expect(authd['dev-1']).to.equal(false);
    });
  });

  it('deny → device stays unauthorized; redirects to the terminal /device/complete', () => {
    callService({
      fn: 'resolveDeviceDecision',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        sessions: SESSION,
        form: { decision: 'deny', deviceAuthId: 'dev-deny', requestId: 'device_dev-deny' },
      },
      inspect: { isDeviceAuthorized: ['dev-deny'] },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/device/complete?decision=deny');
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/device/complete?decision=deny');
      expect((v.inspect?.isDeviceAuthorized as Record<string, boolean>)['dev-deny']).to.equal(
        false
      );
    });
  });

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

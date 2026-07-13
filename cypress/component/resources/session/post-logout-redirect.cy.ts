import { validatePostLogoutRedirect } from '@/resources/session/session-logout.service';

const req = (qs: string) => new Request(`https://auth.localtest.me:30000/id/logout${qs}`);
const ALLOW = ['http://localhost:3001'];

describe('validatePostLogoutRedirect', () => {
  it('allows an absolute URL whose origin is allowlisted', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=http://localhost:3001/login'), ALLOW)
    ).to.equal('http://localhost:3001/login');
  });
});

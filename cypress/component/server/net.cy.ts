// cypress/component/server/net.cy.ts
//
// The 429 page is emitted by Hono middleware, OUTSIDE React Router — nothing prefixes the
// basename for it, and its "Back to sign in" link is the only way off the page.
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { renderRateLimitedPage } from '@/server/net';

describe('renderRateLimitedPage', () => {
  it('links back through APP_BASENAME, not a hardcoded copy of it', () => {
    // A literal `/id/login` here 404s the day the app moves; react-router.config.ts and
    // vite.config.ts already derive their prefix from this constant.
    expect(renderRateLimitedPage(120)).to.contain(`href="${APP_BASENAME}/login"`);
  });

  it('phrases the wait from the Retry-After seconds it was handed', () => {
    expect(renderRateLimitedPage(30)).to.contain('in a few seconds');
    expect(renderRateLimitedPage(120)).to.contain('in about 2 minute(s)');
  });
});

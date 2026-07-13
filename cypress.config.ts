import { runAuditCoverage } from './cypress/support/audit-coverage';
import { registerNodeTasks } from './cypress/support/node/tasks';
import { defineConfig } from 'cypress';
import cypressSplit from 'cypress-split';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

process.env.CYPRESS = 'true';

export default defineConfig({
  e2e: {
    setupNodeEvents(on) {
      on('task', {
        // Governance: static-analysis scanner for logAuthEvent coverage, registry, and PII guard.
        auditCoverage: () => runAuditCoverage(),
        log: (msg) => {
          // eslint-disable-next-line no-console
          console.log(msg);
          return null;
        },
        // RFC 6238 TOTP — lets acceptance specs compute a live authenticator code
        // from the base32 secret shown on the enrollment screen (real Zitadel).
        generateTotp: (secret: string) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { createHmac } = require('node:crypto');
          const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
          const clean = String(secret).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
          let bits = 0;
          let value = 0;
          const bytes: number[] = [];
          for (const ch of clean) {
            const idx = alphabet.indexOf(ch);
            if (idx === -1) continue;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8) {
              bits -= 8;
              bytes.push((value >>> bits) & 0xff);
            }
          }
          const key = Buffer.from(bytes);
          const counter = Math.floor(Date.now() / 1000 / 30);
          const buf = Buffer.alloc(8);
          buf.writeBigUInt64BE(BigInt(counter));
          const hmac = createHmac('sha1', key).update(buf).digest();
          const offset = hmac[hmac.length - 1] & 0x0f;
          const bin =
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff);
          return String(bin % 1000000).padStart(6, '0');
        },
        // Mint a minimal unsigned SAML AuthnRequest encoded for the HTTP-Redirect binding
        // (deflate-raw → base64 → urlencode). Node-side because the browser has no zlib
        // raw-deflate. Returns the ?SAMLRequest= value (already URL-encoded). The seeded SP
        // (entityID https://sp.localtest.me, ACS https://sp.localtest.me/acs) accepts unsigned
        // requests; we ask for the HTTP-POST response binding so Zitadel returns a self-posting
        // form to the ACS (exercises our saml-post BFF page).
        mintSamlRedirect: (opts: { sso: string; sp?: string; acs?: string }) => {
          const sp = opts.sp ?? 'https://sp.localtest.me';
          const acs = opts.acs ?? 'https://sp.localtest.me/acs';
          const id = `_${randomUUID()}`;
          const issueInstant = new Date().toISOString();
          const xml =
            `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
            `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" ` +
            `IssueInstant="${issueInstant}" Destination="${opts.sso}" ` +
            `ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ` +
            `AssertionConsumerServiceURL="${acs}"><saml:Issuer>${sp}</saml:Issuer></samlp:AuthnRequest>`;
          const deflated = deflateRawSync(Buffer.from(xml, 'utf8')) as Buffer;
          return encodeURIComponent(deflated.toString('base64'));
        },
        // Fetch the latest email-verification code for a recipient from Mailpit
        // (Zitadel's SMTP sink). The signup acceptance spec polls this after
        // registering a fresh user. Returns { id, code, userId, link } or null when
        // no message has arrived yet, so the spec can bound its own retry loop.
        // Override the Mailpit base url with Cypress.env('MAILPIT_URL').
        fetchEmailCode: async ({ to }: { to: string }) => {
          const base = String(process.env.MAILPIT_URL ?? 'http://localhost:8025');
          const listRes = await fetch(`${base}/api/v1/messages`);
          if (!listRes.ok) return null;
          const list = (await listRes.json()) as {
            messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
          };
          const want = to.toLowerCase();
          // messages are newest-first; take the most recent for this recipient
          const msg = list.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === want));
          if (!msg) return null;
          const msgRes = await fetch(`${base}/api/v1/message/${msg.ID}`);
          if (!msgRes.ok) return null;
          const body = (await msgRes.json()) as { Text?: string; HTML?: string };
          const text = `${body.Text ?? ''} ${body.HTML ?? ''}`;
          // The verification link carries the resolved code + userId in its query.
          const link = text.match(/https?:\/\/\S*verify\S*/)?.[0] ?? '';
          const code =
            link.match(/[?&]code=([^&\s"']+)/)?.[1] ??
            // Fallback: the body also prints "(Code XXXXX)".
            text.match(/\(Code\s+([A-Z0-9]+)\)/i)?.[1] ??
            '';
          const userId = link.match(/[?&]userId=([^&\s"']+)/)?.[1] ?? '';
          return { id: msg.ID, code, userId, link };
        },
      });
      // Force light color scheme in Electron so axe color-contrast uses light-mode variables.
      on('before:browser:launch', (_browser, launchOptions) => {
        launchOptions.args = launchOptions.args ?? [];
        launchOptions.args.push('--force-prefers-color-scheme=light');
        return launchOptions;
      });
    },
    baseUrl: 'http://localhost:3000',
    // Cypress's HTML/JS rewriting (anti-framebusting) injects a stray text node
    // into <head>, which React 19's strict head hydration flags as a mismatch —
    // the recovery regenerates the tree mid-interaction and silently eats the
    // first click/submit. Our app is same-origin and never framebusts, so the
    // rewriting is safe to disable. (Playwright/real browsers show no mismatch.)
    modifyObstructiveCode: false,
    // set explicitly so the support file is always loaded (Task 12 adds the axe harness here)
    supportFile: 'cypress/support/e2e.ts',
    // acceptance/ added so `bunx cypress run --spec acceptance/...` resolves the file;
    // describe.skip keeps the suite from running until real Zitadel is wired.
    specPattern: ['cypress/e2e/**/*.cy.{js,jsx,ts,tsx}', 'acceptance/**/*.cy.{js,jsx,ts,tsx}'],
  },
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
    viewportWidth: 1280,
    viewportHeight: 720,
    supportFile: 'cypress/support/component.tsx',
    specPattern: 'cypress/component/**/*.{cy,spec}.{js,jsx,ts,tsx}',
    setupNodeEvents(on, config) {
      cypressSplit(on, config);
      // Node-spec harness: runs cookie/session/audit-dependent service logic in real Bun via
      // cy.task('callService', scenario). See cypress/support/node/* and §7 of the conversion recipe.
      registerNodeTasks(on);
      return config;
    },
  },
});

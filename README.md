<p align="center">
  <img
    width="64px"
    src="docs/assets/logo.png"
    style="border: 1px solid #e5e7eb; border-radius: 0.5rem;"
  />

  <h1 align="center">Datum Auth UI</h1>

  <p align="center">
    Authentication for Datum Cloud
  </p>
</p>

---

## About

Datum Auth UI is the login experience for [Datum Cloud](https://datum.net), served at `/id`. It replaces Zitadel's hosted login with a fully-owned React application built on the Datum stack, talking to [Zitadel](https://zitadel.com) over its v2 APIs.

Every authentication ceremony — password, passkey, MFA, SSO, device authorization, password reset — is implemented here, behind a provider seam that keeps Zitadel out of the routes and flows.

### Key Features

- **Complete auth ceremonies** — password, passkeys/WebAuthn, TOTP and OTP, email link, device authorization, password reset and change
- **SSO with identity linking** — Google and GitHub identity providers, auto-create, explicit link and unlink ceremonies
- **Provider seam** — routes and resources depend on an `AuthProvider` interface, never on Zitadel directly, so the identity backend stays swappable
- **Security by default** — signed sessions, CSRF protection, rate limiting, strict CSP and secure headers, fraud signals
- **Internationalized** — Lingui message catalogs with locale detection
- **Production-tested** — Cypress component, end-to-end, and real-Zitadel acceptance suites

### Built With

- **[Bun](https://bun.sh)** — runtime and package manager
- **[React Router 7](https://reactrouter.com)** — SSR framework mode
- **[Hono](https://hono.dev)** — backend-for-frontend server
- **[Zitadel](https://zitadel.com)** — identity platform (v2 APIs)
- **[Tailwind CSS](https://tailwindcss.com) + [datum-ui](https://github.com/datum-cloud/datum-ui)** — styling and components
- **[Lingui](https://lingui.dev)** — internationalization
- **[Cypress](https://cypress.io)** — component, e2e, and acceptance testing

---

## Quick Start

```bash
bun install
cp .env.example .env    # set SESSION_SECRET, ZITADEL_API_URL, ZITADEL_SERVICE_USER_TOKEN, PUBLIC_ORIGIN
bun run dev
```

No Zitadel to hand? Run against the built-in fake provider: `AUTH_PROVIDER=fake bun run dev`

---

## Documentation

Full documentation lives in **[docs/README.md](docs/README.md)** — architecture, configuration, development guides, and operations.

---

## License

[MIT](LICENSE)

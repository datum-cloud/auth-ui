# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately**. Do **not** open a public
issue, pull request, or discussion for a security report.

Use GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/datum-cloud/auth-ui/security/advisories/new)**
(repository **Security** tab → "Report a vulnerability").

We aim to acknowledge a report within 3 business days and to provide a
remediation timeline after triage. Please include reproduction steps, affected
routes/versions, and any relevant logs (with secrets and personal data
redacted).

## Supported Versions

auth-ui is deployed as a rolling service; security fixes land on `main` and are
shipped in the next image release. Only the latest released image / `main` is
supported.

| Version | Supported |
| ------- | --------- |
| `main` (latest) | ✅ |
| older sha-tagged images | ❌ |

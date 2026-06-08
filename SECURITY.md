# Security Policy

## Supported Versions

OpenRoleKB is a single-track project. The `main` branch is the supported version. Past tags are unsupported once the next minor release lands.

| Version | Supported |
| ------- | --------- |
| latest (main) | yes |
| older tags    | no  |

## Reporting a Vulnerability

Please report security vulnerabilities **privately**. Do not open a public GitHub issue.

**Email:** security@openrolekb.app (or open a [private security advisory](https://github.com/himanshu-nakrani/OpenRoleKB/security/advisories/new) on GitHub).

Include:
- A description of the issue and its impact
- Steps to reproduce, or proof-of-concept code
- Affected versions / deployment configurations
- Your assessment of severity
- Whether you want public credit for the disclosure

## What to expect

- **Acknowledgement** within 3 business days.
- **Initial assessment** within 7 business days, including a likely fix timeline.
- **Coordinated disclosure**: we ask reporters to wait until a fix has shipped before publishing details. We will credit you in the release notes unless you ask otherwise.
- **Patch SLA**: critical issues within 7 days, high within 14, others on a best-effort basis.

## Out of scope

- Vulnerabilities in third-party SDKs (Exa, OpenAI SDK, Google Gemini, Prisma, Next.js, etc.) — report those upstream. Tell us if a workaround in our code would help.
- Self-hosted deployments using non-default configurations, modified code, or unsupported infrastructure.
- Vulnerabilities that require a malicious browser extension, compromised device, or social engineering.
- Findings from automated scanners without proof of real-world impact.

## Security best practices for self-hosters

- Set `SENTRY_DSN` and rotate it if leaked.
- Use a managed Postgres provider with row-level encryption (Neon, Supabase, RDS with KMS).
- Set `UPSTASH_REDIS_REST_TOKEN` only via your platform secrets store, never in `.env.production`.
- Keep `AUTH_SECRET` ≥ 32 random bytes (`openssl rand -base64 32`).
- Run `npm audit --production` regularly; Dependabot is configured in `.github/dependabot.yml`.
- The security headers in `next.config.ts` are conservative defaults; relax them only after threat-modeling your deployment.

## Hall of Fame

Researchers who responsibly disclose vulnerabilities will be listed here (with permission). Be the first.

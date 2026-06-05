# Contributing to OpenRoleKB

Thanks for considering a contribution. This guide is written so a new contributor can
make a useful PR within a day, without sifting through Slack history or hidden
conventions.

## Quick start

```bash
git clone https://github.com/himanshu-nakrani/OpenRoleKB.git
cd OpenRoleKB
cp .env.example .env.local           # fill in EXA_API_KEY + GEMINI_API_KEY at minimum
npm install
npx prisma generate
npx prisma migrate dev               # needs a Postgres URL in DATABASE_URL
npm run dev                          # → http://localhost:3000
```

You need:
- Node.js 24 LTS (matches CI)
- Postgres ≥ 15 (Neon, Supabase, or local)
- An [Exa API key](https://exa.ai)
- A [Google Gemini API key](https://aistudio.google.com/apikey) (OpenAI-compatible endpoint configured in `src/lib/llm.ts`)

Optional but recommended:
- [Upstash Redis](https://upstash.com/) for production-grade rate limiting (otherwise an in-memory fallback is used)
- A Sentry project (DSN in env vars enables error tracking)

## How to find work

- **First-time contributors:** issues tagged [`good first issue`](https://github.com/himanshu-nakrani/OpenRoleKB/labels/good%20first%20issue).
- **Larger features:** issues tagged [`help wanted`](https://github.com/himanshu-nakrani/OpenRoleKB/labels/help%20wanted).
- **Anything else:** open an issue first to discuss, especially for changes that touch the search pipeline, schema, or public API. We'd rather catch a design concern in a discussion than at PR review.

## Development workflow

### Branches and commits

- Branch from `main`. Use a short kebab-case branch name: `fix-cache-hit-shape`, `feat-saved-search-cadence`.
- Commit messages: imperative mood, present tense — "Add hide-company filter to cache hit", not "Added" or "Adds." Reference issue numbers in the body when applicable, not the title.
- Squash isn't required, but keep the PR free of "fix typo," "wip," and "address review" merge artifacts.

### Pre-PR checklist

Run all four locally before pushing — CI does the same, and a red CI is a slow review:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

### Testing

- Unit tests live next to the code: `src/lib/__tests__/foo.test.ts`.
- Route tests use real `NextRequest` shapes and SSE-stream parsing — see `src/app/api/search/__tests__/route.test.ts` as a template.
- We use [Vitest](https://vitest.dev/). No mocking framework beyond Vitest's built-ins.
- New behavior should land with a test. Bug fixes should land with a regression test that fails on `main` and passes on the PR.

### Style

- TypeScript strict mode is enabled. No `any` unless interacting with an external SDK that demands it (see `src/lib/exa.ts` for the pattern: cast at the boundary, type internally).
- Prettier-style formatting via ESLint. The project's ESLint config is the authority — `npm run lint -- --fix` resolves most issues.
- Imports use the `@/` alias (`@/lib/foo`), not relative paths above `./` once you're past two levels.
- No comments unless the *why* is non-obvious. Self-documenting names are the standard.
- Keep components colocated. UI primitives live under `src/components/`. Domain logic lives under `src/lib/`.

### Commit signing / DCO

We don't currently require signed commits or a CLA. Submitting a PR is taken as agreement that your contribution is yours to license under Apache 2.0 (see [LICENSE](./LICENSE)). If we ever introduce a CLA we'll grandfather existing contributors.

## Pull request process

1. Open the PR against `main`. Fill in the PR template — it's there to make review fast, not as a hoop.
2. Link the issue(s) it closes.
3. CI will run lint, typecheck, and tests. PRs with red CI won't be reviewed.
4. A maintainer will review within a few business days. Smaller, focused PRs are reviewed faster than sprawling ones.
5. If you're adding a feature, expect questions about cost, telemetry impact, and rollback. Saying "the LLM call is cheap" without naming the per-search delta isn't enough.

### What we'll likely push back on

- Adding new dependencies for things easily done in 20 lines (date formatting, classnames, validation).
- New configuration knobs without a clear default users can keep.
- "While I was here" refactors mixed into a feature PR. Split them.
- Caching that bypasses telemetry. Every request must be observable.
- Anything that touches `prisma/schema.prisma` without a corresponding migration in `prisma/migrations/`.

## Reporting bugs

Use the [Bug template](./.github/ISSUE_TEMPLATE/bug.yml). Include:
- What you ran (the exact query / curl / clicks)
- What you expected
- What you got, with browser console + server log excerpts
- Browser + OS, dev or prod, dark/light mode

## Reporting security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](./SECURITY.md) for responsible disclosure.

## Communication

- Issues for bugs, feature requests, and design discussions.
- [GitHub Discussions](https://github.com/himanshu-nakrani/OpenRoleKB/discussions) for questions, show-and-tell, and "how would I…" threads.
- Pings to maintainers go via issue comments, not DMs — keeps history searchable.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). It's the Contributor Covenant 2.1. Be civil, assume good faith, and don't be the reason this section exists.

## License

By contributing, you agree your contribution is licensed under [Apache 2.0](./LICENSE).

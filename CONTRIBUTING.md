# Contributing to DevTrack

Thanks for helping improve DevTrack.

## Before you start

- For bugs, open an issue with steps to reproduce, what you expected, and what happened.
- For larger features, open an issue first so we can agree on the approach before you write code.

## Local setup

1. Install [Bun](https://bun.sh) 1.3 or later.
2. `bun install`
3. Follow the setup steps in the [README](README.md) to create your Clerk and Convex projects and fill in `.env.local`.
4. `bun run dev`

## Pull requests

- Branch from `main` and keep each PR focused on one change.
- Use [Conventional Commit](https://www.conventionalcommits.org/) style titles, for example `fix(labels): reject empty names`.
- Reference the issue you're fixing with `Fixes #123`.
- Every Convex query and mutation that takes an ID must check that the record belongs to the caller's organization.
- Make sure these pass before requesting review:

```bash
bun run typecheck
bun run lint
bun run test
```

Backend tests live next to the code as `convex/*.test.ts` and run against an in-memory Convex backend with [convex-test](https://docs.convex.dev/testing/convex-test). Add a test when you change a query or mutation.

CI runs the same checks on every pull request.

## Code of conduct

Be respectful and constructive. Harassment or personal attacks are not tolerated.

# TypeScript / Node agent conventions

Conventions for any TypeScript Node project, not for this one in particular.
Kept separate from `AGENTS.md` so this file can be copied to other TypeScript
Node projects unchanged; anything specific to one project belongs in that
project's `AGENTS.md`.

## Git workflow

- **Start from the latest main.** At the start of every session, and before
  opening a branch or PR, run `git fetch origin` and merge `origin/main` into
  the working branch (or branch fresh from it). Resolve conflicts and re-run
  the tests before writing new code — work built on a stale base duplicates
  or contradicts what already landed.

## Node version

- **Always use the latest Node LTS release** — for local development, CI and
  the Docker image alike, and only that one: the app ships as a Docker image,
  so older Node versions don't matter. When a newer LTS line comes out
  (each even-numbered release becomes LTS in October), move everything to it
  in one change: the Dockerfile base image, every `node-version` in
  `.github/workflows/`, and the docs/setup files that name a version. Check
  the current LTS at https://nodejs.org/dist/index.json (the newest entry
  with an `lts` name).

## Docker images: `*_FILE` secrets

- **Every environment variable can also come from a file.** Any project
  that ships a Docker image gives it a POSIX `sh` entrypoint script that,
  before starting the app, finds **every** variable ending in `_FILE`
  (dynamically, not from a fixed list), loads the file it points to into
  the variable without the suffix (`AUTH_SECRET_FILE=/run/secrets/x` →
  `AUTH_SECRET`), unsets the `_FILE` variable, then `exec "$@"` the image's
  `CMD`. This lets operators use Docker Compose/Swarm secrets and Kubernetes
  secret mounts.
- Resolve it in the entrypoint, before the runtime starts, not in app code,
  so libraries that read `process.env` themselves (and other runtimes, such
  as an edge runtime that can't read files) see the value too.
- Strip trailing newlines (LF and CRLF); keep everything else literally.
- **Refuse to start** if both `NAME` and `NAME_FILE` are set, or the file is
  missing, unreadable or empty. Errors name the variable and path, never the
  file's contents.
- Don't name it `docker-entrypoint.sh` inside the image if the base image
  already has one (the `node` images do): install it under a project name,
  e.g. `/usr/local/bin/<project>-entrypoint.sh`, and set `ENTRYPOINT` to it.
- Test it: unit tests that run the real script with `sh` (each rule above),
  and an end-to-end check that starts the built image with at least one
  setting given as `_FILE` so CI fails if the entrypoint breaks.
- Document it next to the environment-variable reference, with a Compose
  `secrets:` example.

## Dependency security

- **Every npm run checks for vulnerable libraries.** Whenever you run
  `npm install`, `npm ci`, `npm run dev`, `npm run build` or similar, look
  at npm's vulnerability report (`npm audit`). If it lists anything, fix it
  in the same piece of work by upgrading the libraries as needed — prefer
  in-range updates (`npm update <pkg>`), then newer majors, then an
  `overrides` entry for a patched transitive version. Never "fix" by
  downgrading (`npm audit fix --force` often proposes old majors).
- **Report it explicitly to the user** every time: what was found
  (package, advisory, severity, dev-only or shipped), what you upgraded,
  and anything left that can't be fixed yet (e.g. no patched release
  exists) with its real exposure.
- **Before a PR is ready**, run `npm audit` and `npm audit --omit=dev` again
  and state the result in the PR description.
- Make lockfile changes with the npm that ships with the project's Node
  version (an older npm rewrites unrelated parts of `package-lock.json`).

## Code conventions

- TypeScript strict mode.
- **Interfaces end with the `Interface` suffix** — e.g. `StoreInterface`,
  `VaultEngineInterface`. Always.
- Files used only by tests must say so in their filename: `*.test.ts` for test
  files, `*.test-helper.ts` for shared test helpers (e.g.
  `store-contract.test-helper.ts`, `fake-drive.test-helper.ts`).
- Keep `README.md`'s Features list in sync: every user-facing feature added
  or changed must be reflected there in the same PR.
- Prefer single source of truth for data and logic over replication.
- Create UI tests, if applicable, using Playwright tests. Prefare running the Playwright tests using docker containers.
  More info can be found here: https://playwright.dev/docs/docker.
  The UI tests should be exhaustive smoke tests that should cover each and every feature the application has or provides.
  For each bug discovered and fixed, if it is UI related, make sure to add a test in Playwright setup and not just unit tests.
- Errors related to security should give minimum feedback and nothing specific. 
  For example: If a form requires username and two factor code, do not respond pointing out whether the password 
  was wrong or the code was wrong, rather respond by a generic login failure message that says one of the input is wrong.

## Constants

- **All constants live in `src/constants.ts`.** No other file holds string
  literals: names, keys (storage keys, cookie and header names, error codes),
  URLs and endpoints, file names, limits, durations, and also user-facing
  text (labels, messages, errors) and log messages. When in doubt, a string
  literal goes in `src/constants.ts` and is imported from there.

## External input: schema validation (Zod)

- **Every piece of external data is checked against a schema** before the
  code uses it: API responses, request bodies, files read from disk or
  storage, environment-derived config, messages from other processes or
  workers. Nothing external is trusted or cast to a type unchecked.
- **Schemas are written with [Zod](https://zod.dev)**, the single source of
  truth for both the check and the type. No other schema or validation
  library.
- **One file per schema**, named `xxx.schema.ts`, exporting the Zod schema
  and its type. Code that checks a payload imports the schema from there.
- **Types come from the schemas** via `z.infer<typeof xxxSchema>`, never
  written by hand, so a type can't drift from the schema that checks it.
- **One reusable validation engine.** A single checker, a thin wrapper
  around Zod's `safeParse`, is called with the schema and the payload
  wherever input needs checking. It returns the typed value, or errors
  reduced to path and issue code. Errors never carry payload values, since
  payloads can hold tokens and secrets that must not reach logs or
  responses. No ad-hoc, hand-written shape checks elsewhere.
- **Strict or lenient on purpose:** `z.strictObject` (unknown fields
  rejected) for input defined by this project, such as its own request
  bodies; `z.looseObject` for data defined by someone else or written by
  another version of the app (third-party API responses, stored files),
  which may legitimately gain fields.
- **JSON Schema files only when something else needs them**, generated from
  the Zod schemas with `z.toJSONSchema()` at build time. Never edited by
  hand, never used for validation.

## Component pattern (interface / provider / factory)

Every new component keeps its contract separate from its implementations:

1. **Own folder** — each component lives in a folder under `src/lib/` named
   after it, e.g. `src/lib/store/` for a store.
2. **Interface** — the contract is a TypeScript `interface` whose name ends
   with `Interface`, in a file ending in `-interface.ts`
   (`store-interface.ts` → `StoreInterface`).
3. **Providers** — each implementation is a class ending in `Provider`, one
   per file, under a `providers/` subfolder
   (`providers/memory-store-provider.ts` → `MemoryStoreProvider`). Add a
   NOP provider (`NopStoreProvider`: empty/default results, writes
   discarded) unless an existing provider already serves that role — e.g.
   an in-memory provider that works without external services.
4. **Factory** — exactly one `factory.ts` per folder chooses and constructs
   the provider, and contains only factory functions (no request handling,
   auth or other helpers — those get their own file, e.g.
   `src/lib/store/get-store.ts`). Factory function names end with
   `Factory` and decide each provider's lifetime: stateless providers get a
   fresh instance per call, stateful ones a cached instance per caller key
   (`createStoreFactory()`).
5. **Depend on the interface only** — outside `factory.ts`, parameters,
   fields and return types use the `…Interface`. Providers are imported
   only by `factory.ts` and their own tests; consumers obtain instances from
   the factory or have them passed in.
6. **Single import point** — `src/factory.ts` re-exports every factory
   function; always import factories from `@/factory`, never from the
   per-folder file.

**Why:** the pattern exists to make testing simple. Because consumers only
see the interface, tests can hand them a NOP/in-memory provider or a fake
without module mocking, and a shared contract suite
(e.g. `store-contract.test-helper.ts`) runs against every provider.

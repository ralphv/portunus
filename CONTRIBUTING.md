# Contributing to Portunus

Thanks for your interest! Issues and PRs are welcome. By participating you
agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security problem?
**Don't open an issue** — follow [SECURITY.md](SECURITY.md).

> **Never post vault contents, keyfiles (`portunus.key`), recovery codes, or
> master passwords** in issues, PRs, logs, or screenshots, and **never commit
> `*.key` or `.env*` files** (both are gitignored — keep it that way).

## Development setup

Requirements: Node.js 24 (CI also tests 20.x and 22.x) and npm.

```bash
npm install
```

To sign in with Google locally, create `.env.local` (gitignored):

```bash
AUTH_GOOGLE_ID=your-google-oauth-client-id
AUTH_GOOGLE_SECRET=your-google-oauth-client-secret
AUTH_SECRET=generate-with-openssl-rand-hex-32   # or: npx auth secret
AUTH_URL=http://localhost:3000
```

See the README's [Google OAuth setup](README.md#google-oauth-setup-required-once-per-self-hoster)
for creating the OAuth client. No Google account handy? Run
`PORTUNUS_DEMO_MODE=1 npm run dev` for a stubbed sign-in and an in-memory
vault (never use demo mode with real secrets).

Optional: `PORTUNUS_HIBP_ON_EDIT=0` disables the automatic Have I Been Pwned
check on password edits (see the README's Configuration section).

`npm test`, `npm run lint`, and `npm run build` need none of these variables.

## Commands

```bash
npm run dev         # dev server on http://localhost:3000
npm test            # vitest (unit + integration tests, node env)
npm run test:watch  # vitest watch mode
npm run lint        # eslint
npm run build       # production build (standalone output; also type-checks)
```

CI (`.github/workflows/node.js.yml`) runs `npm ci`, `npm run lint`,
`npm run build`, and `npm test` on every PR — run them locally first.

## Conventions

See [AGENTS.md](AGENTS.md) for the full list. The essentials:

- **Zero-knowledge rule**: the server must never see plaintext vault data,
  the master password, the keyfile, or the data key. All crypto runs
  client-side; `/api/vault` treats the envelope as an opaque string and must
  never parse it. PRs that weaken this will not be merged.
- **TypeScript strict mode**.
- **Interfaces end with `Interface`** — e.g. `VaultEngineInterface`,
  `StoreInterface`. Always.
- **Crypto modules are client-safe**: nothing in `src/crypto/` may use
  Node-only APIs.
- Swappable implementations follow the interface/provider pattern in
  `src/lib/<component>/` (`*-interface.ts`, `providers/*Provider`, one
  `factory.ts`; import factories from `@/factory`).
- Test-only files say so in their name: `*.test.ts`, `*.test-helper.ts`.
- Client components only where interactivity is needed.
- Keep the README **Features** list in sync with every user-facing change,
  in the same PR.
- Third-party calls from the browser (like the HIBP range API) must never
  carry vault plaintext, and must be documented in SECURITY.md's threat model.

## Pull requests

1. Fork and create a topic branch from `main`.
2. Keep changes focused; add or update tests (crypto changes need tests for
   tamper/wrong-secret paths too).
3. Run `npm test`, `npm run lint`, and `npm run build`.
4. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
   user-visible changes.
5. Open a PR describing what changed and why; link related issues. Changes
   to `src/crypto/`, `src/auth.ts`, or `src/app/api/vault/` get extra review
   — see "What to audit" in [SECURITY.md](SECURITY.md).

Contributions are licensed under [AGPL-3.0](LICENSE).

## Releases and Docker images (maintainers)

Releases are cut by pushing a semver tag (`git tag vX.Y.Z && git push origin vX.Y.Z`)
after bumping `version` in `package.json` and updating `CHANGELOG.md`. The
[Docker workflow](.github/workflows/docker-publish.yml) builds a multi-arch
image (`linux/amd64`, `linux/arm64`), signs it with cosign, and pushes tags
like `latest`, `vX.Y.Z`, `vX.Y`, `main`, and `sha-<short>`:

- **GHCR** (`ghcr.io/ralphv/portunus`) — works out of the box via `GITHUB_TOKEN`.
- **Docker Hub** (`docker.io/<DOCKERHUB_USERNAME>/portunus`) — optional. Set
  these repository secrets (Settings → Secrets and variables → Actions):
  - `DOCKERHUB_USERNAME` — your Docker Hub username (also the image namespace)
  - `DOCKERHUB_TOKEN` — a Docker Hub [access token](https://docs.docker.com/security/for-developers/access-tokens/)
    with read/write scope

  Without them, the Docker Hub login and tags are skipped and only GHCR is published.

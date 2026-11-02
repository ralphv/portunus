# Portable agent conventions

Project-independent conventions for TypeScript projects. Kept separate from
`AGENTS.md` so this file can be copied to other projects unchanged; anything
specific to one project belongs in that project's `AGENTS.md`.

## Git workflow

- **Start from the latest main.** At the start of every session, and before
  opening a branch or PR, run `git fetch origin` and merge `origin/main` into
  the working branch (or branch fresh from it). Resolve conflicts and re-run
  the tests before writing new code — work built on a stale base duplicates
  or contradicts what already landed.

## Code conventions

- TypeScript strict mode.
- **Interfaces end with the `Interface` suffix** — e.g. `StoreInterface`,
  `VaultEngineInterface`. Always.
- Files used only by tests must say so in their filename: `*.test.ts` for test
  files, `*.test-helper.ts` for shared test helpers (e.g.
  `store-contract.test-helper.ts`, `fake-drive.test-helper.ts`).
- Keep `README.md`'s Features list in sync: every user-facing feature added
  or changed must be reflected there in the same PR.

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

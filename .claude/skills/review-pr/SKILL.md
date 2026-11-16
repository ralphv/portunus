---
name: review-pr
description: Review a Portunus pull request the house way — a separate reviewer session posts its findings as inline PR review comments, this (main) session addresses every one, resolves every thread, and reports "Review is done, ready for merging". Use whenever the user asks to review a PR (or "the PR", "my changes", "since the last review").
---

# Review a PR

Two sessions, two roles:

- **Reviewer** — a *new* Claude Code session. It only reads the code and
  posts findings on the PR. It never pushes, approves, requests changes or
  merges.
- **Main session** (the one the user asked) — addresses every finding,
  closes every thread, and reports back.

## 1. Main session: start the reviewer

1. Find the PR (the one this branch has open, or the number the user gave)
   and its scope: the whole PR the first time; on a re-review, only the
   commits since the last review (name the base and head SHAs).
2. Make sure this session is subscribed to the PR's activity
   (`subscribe_pr_activity`) so the reviewer's comments arrive here.
3. Start the reviewer with `create_session` (claude-code-remote MCP):
   `source_url` = the repo, `source_revision` = the PR's head branch,
   `title` = `Review PR #<N> (<short topic>)`, and the prompt below with the
   placeholders filled in.

```text
Review the pull request <PR URL> (head branch <branch>, base <base>).
Scope: <whole PR | only the changes from <base-sha> to <head-sha>>.
Context: <one or two sentences on what the PR is meant to do and any
constraints the user gave, e.g. "UI only, no logic changes">.

Post your findings as inline review comments on the PR: use the
code-review skill if available (e.g. `/code-review high <N> --comment`);
otherwise create a pending review with the GitHub MCP tools, add one inline
comment per finding, and submit it as COMMENT. Never APPROVE or
REQUEST_CHANGES, never push, never merge.

Check correctness first (behaviour changes that shouldn't be there, broken
edge cases, light/dark and mobile regressions), then the repo rules in
AGENTS.md and AGENTS-TSNODE.md (constants in src/constants.ts, colours
only via palette roles in src/app/palette.css, Zod at server boundaries,
a smoke assertion + SMOKE.md row for every user-facing change, README
Features in sync). Ignore the .devin/ folder entirely (the owner doesn't
maintain it; don't flag it). Verify each finding before posting; say how severe it
is and how to fix it. Finish with a short summary of what you posted.
```

4. Tell the user the review session is running. Don't guess at its
   findings; wait for the comments to arrive.

## 2. Main session: address every comment

When the reviewer's comments arrive (PR activity events), read **all** open
review threads (`pull_request_read` → `get_review_comments`) and handle
each one:

- **Valid:** fix it. Run the fast checks on what changed (`npm test`,
  `npm run lint`, and `npm run build` plus the smoke suite for UI changes),
  commit, push to the PR branch, then reply on the thread:
  `Fixed in <sha>. <what changed>`.
- **Not valid, or not worth changing:** don't change code. Reply with a
  short note saying why (what you checked, or why it's out of scope /
  intended / a follow-up).
- **Needs the user's decision** (design choice, security trade-off): ask the
  user. Once they decide, act on it and reply on the thread with the
  decision.

Then **resolve every thread** (`resolve_review_thread`), whether fixed or
noted, including outdated ones. Nothing is left unresolved. Batch the fixes
into as few pushes as practical, and reply only after the fix is pushed.

## 3. Main session: report

Wait for CI on the final head commit. Every check must be green; fix any
red check the same way (find the cause and fix it, never skip or disable a
test). Then confirm there are 0 unresolved review threads and no merge
conflict with the base, and report to the user:

> **Review is done, ready for merging.**

Below that line, list each finding with its outcome (fixed in `<sha>` /
noted: reason), the CI status, and anything that still needs the user, e.g.
a branch-protection approval they must give themselves. Don't approve or
merge; that is the user's call.

---
merge: auto
merge_deploys: yes
deploy: auto
always_ask: src/io/ src/core/codec.ts src/core/validate.ts src/core/ports.ts src/ui/transfer.ts vite.config.ts package.json package-lock.json .claude/
---
<!--
Read by ~/.claude/hooks/ask-before-merge.sh from the default branch on GitHub
(template: aherzfeld/claude-config templates/AUTONOMY.md). A change takes effect
only once merged to main, and a PR changing this file always asks.
-->
# Autonomy - eisenhower-matrix

What a session working in this repo may do without asking the owner, and what
it must always ask about. The front matter is the machine-read part; this prose
is the rest of the agreement.

## Without asking

- Merge a PR once CI is green and the Opus review is clean, when the hook's
  conditions hold (front matter above), pinned to the head whose CI passed:
  `gh pr merge <n> --squash --match-head-commit <full sha>`, with the sha from
  `gh pr view <n> --json headRefOid -q .headRefOid`. Run the merge as its own
  command, not chained after anything.
- Merge-and-deploy a green, reviewed PR that touches no `always_ask` path.
- Open and update PRs, file and comment on issues.

## Always ask

The floor applies whatever this file says elsewhere:

- Deploys ask, except the Cloudflare Pages deploy a merge to `main` triggers:
  `deploy: auto` above makes every autonomous merge a production deploy.
- Deleting accounts or data.
- Writes to a production database.
- Secrets: creating, rotating, reading out or moving them.
- Cloudflare and DNS changes.
- Force-pushes.
- Editing AUTONOMY.md itself. A PR that changes it, or anything under
  `.github/`, always asks before it merges.

This repo's own:

- How tasks are saved, loaded, validated, imported and exported: that is
  where data loss would happen.
- Build config and dependencies.
- Decisions awaiting the owner on open issues.

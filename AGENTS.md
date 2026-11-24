# dibs agent rules

- Generate the codebase summary with `nubx repomix --ignore "node_modules/**,nub.lock"`. `repomix` is not installed globally; always run it through `nubx`. Delete `repomix-output.xml` when done.
- Run tests with `nub run test`. Pi loads `plugins/pi/index.ts` directly, but it imports core from `packages/dibs/lib/`, so run `nub run build` after editing `packages/dibs/src/` (`nub install` builds it once).
- Commit with `wt step commit` (Worktrunk generates the message from the diff via your configured LLM in `~/.config/worktrunk/config.toml`); then `git push`. Do not hand-write commit messages.
- When creating an implementation/action plan, split it into small tasks and delegate them to subagents on smaller models (e.g. Haiku/Sonnet) with low or no thinking. You review and test their output before moving on.
- Load the `technical-writing` skill (`.agents/skills/technical-writing`) before writing or editing any docs (README, CONTRIBUTING, CHANGELOG, agent READMEs, SKILL.md).

## Code search

Use `semble search` (see the semble skill) instead of grep. If `semble` is not on `$PATH`, use `uvx --from "semble[mcp]" semble`.

# Release pipelines for dibs

Researched 2026-11-22 against the projects' checked-in workflows. Links point to moving branches. No release was executed.

Dex is the closest comparison: it is a Node task tracker published to npm. Its separation of ordinary CI from a tag-triggered publish is a useful starting point for dibs. Backlog.md and Beads show additional controls, but their larger artifact pipelines are not a reason to copy their complexity.

## Dibs today

[`scripts/bump.ts`](../../scripts/bump.ts) requires a clean tree, runs tests, bumps one package, commits, tags and pushes, then invokes [`scripts/release.ts`](../../scripts/release.ts). The latter publishes the root, Pi and OpenCode packages to npm in order, skipping versions already visible, and publishes the root package to JSR. The packages have independent versions, so a check requiring all three npm versions to match would be wrong. The root `package.json` and `jsr.json` should agree on their version.

The tag is pushed before publishing finishes. A publish failure can leave a tag without the corresponding registry version; the release script can be rerun to skip versions already visible. There is no tracked GitHub Actions workflow. The bump script runs tests, but does not explicitly run the separate `check` or `pack:check` scripts in [`package.json`](../../package.json).

## Comparisons

| Project | Evidence | Relevance to dibs |
|---|---|---|
| Dex | [CI](https://github.com/dcramer/dex/blob/main/.github/workflows/ci.yml) runs on pushes and pull requests, installs with a frozen lockfile, builds and tests. Its [publish workflow](https://github.com/dcramer/dex/blob/main/.github/workflows/publish.yml) runs from tags, tests and builds, and publishes to npm with provenance and scoped permissions. | Separate routine validation from publishing, and gate publishing on validation. Trusted publishing requires registry and repository setup; the workflow alone does not configure it. |
| Backlog.md | [CI](https://github.com/MrLesk/Backlog.md/blob/main/.github/workflows/ci.yml) tests on Linux, macOS and Windows. Its [release workflow](https://github.com/MrLesk/Backlog.md/blob/main/.github/workflows/release.yml) builds and packages platform executables from tags. | A platform matrix can expose OS-specific failures. Its binary distribution pipeline is not directly needed for dibs' npm and JSR packages. |
| Beads | Its [release workflow](https://github.com/steveyegge/beads/blob/main/.github/workflows/release.yml) checks tag/version consistency, serializes release work by ref and separates gates from publishing. Its npm job uses trusted publishing and provenance. | Check the selected package against its tag and serialize overlapping publication. Beads is a larger Go project, so its full workflow is not a suitable template. |

## Recommendation

Start with automated CI for type checking, tests, build and package inspection. Add a tag-triggered release only if removing local publishing friction is worth the registry and GitHub configuration. Before publishing, validate the tag against the selected package and, for the root package, validate the JSR version. Preserve independent package versions, dependency ordering and the ability to retry partially completed releases.

A CI release still needs a strategy for partial npm/JSR failures and credentials for each registry. Test packed artifacts as installed packages before relying on a dry-run file list. Consider a platform matrix only after identifying which core and adapter tests can run on each OS.

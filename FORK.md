# Hydra

Hydra is an independent fork of [Orca](https://github.com/stablyai/orca),
maintained at [juan-pujante/hydra](https://github.com/juan-pujante/hydra).
Its goal is to improve multi-agent coordination with its own decisions and
schedule, while retaining the ability to integrate improvements from Orca.

## Baseline and license

- Initial Orca baseline revision: `519bde81df438478ff1c6ac010f1339f32a306ee`.
- The Git history and [original MIT license](LICENSE) are preserved.
- This setup adds documentation; it does not yet change the application's
  behavior, identity, or external services.
- Download links in the original README point to Orca. Hydra does not yet
  publish its own installers.

## Remotes and branches

- `origin`: `https://github.com/juan-pujante/hydra.git`.
- `upstream`: `https://github.com/stablyai/orca.git`.
- `main`: stable version of Hydra.
- `feature/<improvement>` and `fix/<issue>`: small, reviewable changes of our own.
- `sync/orca-<date>`: temporary integration of an upstream update.

For a new checkout, clone `origin` and add `upstream`. Recommended local
configuration (does not affect other repositories):

```sh
git remote add upstream https://github.com/stablyai/orca.git
git config remote.pushDefault origin
git config pull.ff only
git config rerere.enabled true
```

`rerere` remembers conflict resolutions for reuse; always review the result.
Do not rewrite the published history of `main` or force-push to match Orca.

## Upstream review and integration cadence

Review upstream changes weekly and prioritize stable Orca releases as integration
points. This is a maintenance policy, not an automatic sync or scheduled job.

- Security fixes and fixes for failures affecting Hydra: review and integrate
  promptly after validation.
- Stable releases: use as the usual integration points, with Hydra's own tests.
- Routine changes on `upstream/main`: review weekly and integrate when useful.
- Large or experimental changes: wait until they stabilize.

Being behind upstream is not itself a reason to merge. Review the changes before
choosing a release or commit to integrate; do not automatically follow every commit
or let differences accumulate for months. Upstream integration is deferred for now.

Keep `main` stable. Use one branch per feature, fix, or upstream integration and
review changes through a PR in Hydra; no permanent `develop` branch is needed.
Validate Desktop and affected Hydra features before merging. Preserve upstream
ancestry with merge commits for both the integration and its PR.

All commit messages must be in English, without co-author attribution or
`Co-authored-by` trailers.

## Integrating an Orca update

Start with a clean working tree and replace `YYYY-MM-DD` with the date:

```sh
git switch main
git pull --ff-only origin main
git fetch upstream main --no-tags
git switch -c sync/orca-YYYY-MM-DD
git merge --no-ff upstream/main
```

You can also integrate a specific commit that has already been fetched instead
of `upstream/main`. Resolve and review conflicts while preserving Hydra's own
decisions. To abandon a merge with conflicts, use `git merge --abort`.

Validate the integration following [CONTRIBUTING.md](.github/CONTRIBUTING.md),
including lint, type checks, tests, and the build, as well as tests for any
affected custom features. Record the integrated Orca revision and any changes
deliberately adapted or reverted in this document.

Push the branch and open the PR **in Hydra**, always specifying the repository
to prevent GitHub CLI from targeting the upstream project:

```sh
git push -u origin sync/orca-YYYY-MM-DD
gh pr create --repo juan-pujante/hydra --base main --head sync/orca-YYYY-MM-DD
```

Use the repository's PR template. Integrate upstream updates with a **merge
commit**, not squash or rebase: Orca's ancestry must be preserved for future
merges. Reserve `cherry-pick -x` for targeted fixes and review their dependencies.

## Independent development

Keep improvements separate from reformatting and renaming. Reuse the existing
mechanisms for terminals, worktrees, agent status, and remote execution;
document any changes to their contracts here. Prepare contributions to the
upstream project on separate branches based on `upstream/main`.

Before distributing Hydra or using it alongside an Orca installation, prepare
a dedicated identity change and check:

- Application identifiers, display name, and keychain access.
- Data directories, profiles, sockets, and helper processes.
- CLI command and protocol/link registration.
- Updates, release repository, and installer signing.
- External services and compatibility with remote hosts and mobile clients.

Changing the name in `package.json` is not enough. Identity separation requires
validation before claiming that the two applications can coexist.

## Record of differences

| Change | Reason | Impact on future upstream integrations |
| --- | --- | --- |
| `FORK.md` | Document Hydra's ownership, baseline, and maintenance | Fork-specific file; no runtime changes |

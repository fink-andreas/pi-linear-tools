# Release Runbook

This runbook applies to `@fink-andreas/pi-linear-tools` and is deliberately version-agnostic. A release is complete only when the GitHub release and the npm artifact represent the same version and source.

## Non-negotiable parity rules

1. **Start from the latest remote `main`.** Fetch first; do not use a stale local branch as the release base.
2. **Land the release commit on remote `main` before tagging.** A release branch or GitHub release by itself does not update `main`.
3. **Tag the exact `origin/main` release commit.** Do not tag the release branch before its changes are merged.
4. **Publish npm from the exact tag.** Build/check the package after checking out the tag, not from an unrelated working branch.
5. **Verify the downloaded npm tarball.** Matching version strings are not enough; compare the published package files with the tagged source.
6. **Do not reuse or move public versions.** npm versions are effectively immutable, and moving a Git tag does not change an existing npm tarball. If the wrong artifact was published, use the next patch version rather than force-moving the public tag.
7. **Do not declare success while any gate is blocked.** An npm authentication failure means the release is not complete.
8. **List non-maintainer contributors in the release notes; omit `fink-andreas` from contributor credits.**

## 1. Create a release branch from remote `main`

Set the version for the release being prepared:

```bash
VERSION=0.8.3             # replace with the intended next version
TAG="v${VERSION}"
PACKAGE="@fink-andreas/pi-linear-tools"
REPO="fink-andreas/pi-linear-tools"
```

Synchronize and verify the base. Do not silently reset a divergent local `main`; investigate and preserve any local-only work first.

```bash
git fetch origin --prune
git switch main

# Stop if tracked work is present. Do not stage unrelated user files.
test -z "$(git status --porcelain=v1 --untracked-files=no)" || {
  echo "Tracked changes are present; stop and resolve them before releasing." >&2
  exit 1
}

git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git switch -c "release/${TAG}"
```

If the release branch already exists, stop and inspect it instead of reusing an ambiguous branch.

## 2. Prepare and validate the release

Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and `docs/RELEASE_NOTES_${TAG}.md`. Include the non-maintainer contributor credits required by the project convention.

`npm version` can update both package version fields without creating a tag:

```bash
npm version "$VERSION" --no-git-tag-version
VERSION="$VERSION" node -e 'const fs=require("fs"); const p=require("./package.json"); const l=require("./package-lock.json"); if (p.version !== process.env.VERSION || l.version !== process.env.VERSION || l.packages[""].version !== process.env.VERSION) process.exit(1); console.log(`${p.name}@${p.version}`)'
```

Run the full release check and inspect the package contents:

```bash
set -o pipefail
npm run release:check 2>&1 | tail -n 35
npm pack --dry-run

git diff --check
git status --short
```

Before committing, confirm that the release notes file exists and that the package version, changelog heading, and release notes all use the same `VERSION`.

## 3. Commit, push, and merge into `main`

Stage only release files and inspect the staged diff:

```bash
git add package.json package-lock.json CHANGELOG.md "docs/RELEASE_NOTES_${TAG}.md"
git diff --cached --check
git diff --cached --stat
git commit -m "chore(release): prepare ${TAG}"
git push -u origin "release/${TAG}"
```

Merge the release branch into `main` through the repository's normal approved GitHub PR workflow (use `gh pr create`/`gh pr merge`). If repository policy explicitly permits a fast-forward release push, this is the alternative:

```bash
git push origin "release/${TAG}:main"
```

Do **not** tag until the merge is complete. Refresh the remote refs and record the actual release commit:

```bash
git fetch origin --prune
MAIN_SHA=$(git rev-parse origin/main)
printf 'release commit: %s\n' "$MAIN_SHA"
git show "origin/main:package.json" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s); console.log(`${p.name}@${p.version}`)})'
```

A merge commit is acceptable; the tag must point to this post-merge `origin/main` commit.

## 4. Create the GitHub tag and release

Create the tag only after verifying that the intended version is on remote `main`. Never force-update an existing public tag.

```bash
git switch --detach origin/main
test -z "$(git ls-remote --tags origin "refs/tags/${TAG}")" || {
  echo "Tag ${TAG} already exists; stop instead of moving it." >&2
  exit 1
}

git tag -a "$TAG" -m "Release ${TAG}"
git push origin "$TAG"
gh release create "$TAG" \
  --verify-tag \
  --target main \
  --title "$TAG" \
  --notes-file "docs/RELEASE_NOTES_${TAG}.md" \
  --latest

gh release view "$TAG" --json tagName,targetCommitish,isDraft,isPrerelease,url
```

If a GitHub release is created but npm publishing fails, fix authentication and resume. Do not move the tag to a different commit.

## 5. Publish npm from the tag

Check out the exact tag and run the package checks again before publishing:

```bash
git fetch origin --tags
git switch --detach "$TAG"
test "$(node -p "require('./package.json').version")" = "$VERSION"
npm run release:check
npm whoami
npm publish --access public
```

`npm whoami`/`npm publish` may require manual browser authentication and an OTP. Do not automate or skip that step.

## 6. Final GitHub/npm parity gate

Run the post-release checks in [`POST_RELEASE_CHECKLIST.md`](POST_RELEASE_CHECKLIST.md). At minimum, all of these must pass:

```bash
git fetch origin --prune --tags
TAG_SHA=$(git rev-parse "${TAG}^{commit}")
MAIN_SHA=$(git rev-parse origin/main)
test "$TAG_SHA" = "$MAIN_SHA"
printf 'GitHub main/tag parity: %s\n' "$MAIN_SHA"

test "$(npm view "$PACKAGE" version)" = "$VERSION"
test "$(npm view "$PACKAGE@$VERSION" version)" = "$VERSION"
test "$(npm view "$PACKAGE" dist-tags.latest)" = "$VERSION"
```

Download the published artifact and compare package files with the tag. npm does not store a Git SHA, so this content check is the authoritative artifact comparison:

```bash
TMP_DIR=$(mktemp -d)
NPM_TARBALL=$(npm pack "${PACKAGE}@${VERSION}" --pack-destination "$TMP_DIR" --silent)
tar -xzf "$TMP_DIR/$NPM_TARBALL" -C "$TMP_DIR"

while IFS= read -r FILE; do
  git show "${TAG}:${FILE}" > "$TMP_DIR/tag-source"
  cmp "$TMP_DIR/tag-source" "$TMP_DIR/package/$FILE"
done <<'EOF'
package.json
CHANGELOG.md
extensions/pi-linear-tools.js
src/linear.js
EOF

echo "npm tarball matches the tagged release files"
```

Only after the GitHub identity, npm version/dist-tag, downloaded tarball, and install smoke test all pass should the release be reported as complete.

## Recovery rules

- If `origin/main` and the tag differ before publishing, stop and correct the branch/merge flow.
- If npm already contains the requested version but its tarball is wrong, do not use `npm publish --force`, reuse the version, or force-move the GitHub tag. Prepare the next patch version.
- If npm authentication fails, leave the verified tag in place and mark npm publication as pending; do not claim parity.
- If the published npm tarball is wrong, the existing npm version cannot normally be repaired in place. Publish a new patch version and make that version the matching GitHub release/latest version.

# Post-release verification checklist

Use this checklist only after the GitHub tag/release and npm publish commands have completed. Replace the values below with the release under verification.

```bash
VERSION=0.8.3
TAG="v${VERSION}"
PACKAGE="@fink-andreas/pi-linear-tools"
```

## GitHub identity

The tag must resolve to the same commit that was on remote `main` when the release was made. A release branch name or a GitHub release page alone is not sufficient.

```bash
git fetch origin --prune --tags
TAG_SHA=$(git rev-parse "${TAG}^{commit}")
MAIN_SHA=$(git rev-parse origin/main)
printf 'tag=%s\nmain=%s\n' "$TAG_SHA" "$MAIN_SHA"
test "$TAG_SHA" = "$MAIN_SHA"

gh release view "$TAG" --json name,tagName,targetCommitish,isDraft,isPrerelease,publishedAt,url
```

Confirm manually that the release is published, not a draft or prerelease, and that its tag is exactly `$TAG`.

## npm identity

All npm version checks must return the release version, including the `latest` dist-tag.

```bash
test "$(npm view "$PACKAGE" version)" = "$VERSION"
test "$(npm view "$PACKAGE@$VERSION" version)" = "$VERSION"
test "$(npm view "$PACKAGE" dist-tags.latest)" = "$VERSION"
npm view "$PACKAGE" version dist-tags --json
```

If npm authentication or any version check fails, the release is not complete.

## Published tarball content

Matching version numbers do not prove that the correct source was published. Download the registry artifact and compare representative published files with the exact Git tag:

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

echo "published npm tarball matches the GitHub tag"
```

For releases containing error-handling changes, also confirm the published source contains the expected wrapper/cause preservation. For this project, the file comparison above must include `extensions/pi-linear-tools.js` and `src/linear.js`.

## Clean-install smoke test

Install into a temporary prefix so the verification does not alter the global environment:

```bash
INSTALL_PREFIX=$(mktemp -d)
npm install --prefix "$INSTALL_PREFIX" "$PACKAGE@$VERSION" --no-fund --no-audit
"$INSTALL_PREFIX/node_modules/.bin/pi-linear-tools" --help
```

The CLI help command must succeed. An npm install warning about optional/approval-gated native install scripts should be investigated separately, but must not be mistaken for a successful parity check if installation itself fails.

## Pi package route smoke test

Run when validating the installed extension route:

```bash
pi install git:github.com/fink-andreas/pi-linear-tools
# enable the extension resource, then run in pi:
/linear-tools-help
```

If install/remove sources changed, fully restart pi before validating; `/reload` alone may not reload source changes.

## Basic command smoke test

With valid Linear credentials:

```bash
pi-linear-tools project list
pi-linear-tools team list
```

## Closeout

- Confirm release notes list non-maintainer contributors and omit `fink-andreas` from contributor credits.
- Capture regressions as follow-up Linear issues.
- Post the release summary to INN-234.
- Mark the release milestone complete.
- Record the verified tag SHA, npm version, and npm tarball check in the release record.

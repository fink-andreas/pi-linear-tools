# Release Runbook

## npm publish (`v0.1.0`)

1. Ensure clean working tree
   ```bash
   git status
   ```
2. Run pre-publish checks
   ```bash
   npm run release:check
   ```
3. Verify npm authentication
   ```bash
   npm whoami
   ```
4. Publish package
   ```bash
   npm publish --access public
   ```
5. Verify published version
   ```bash
   npm view @fink-andreas/pi-linear-tools version
   ```

## Post-publish quick validation

```bash
npm install -g @fink-andreas/pi-linear-tools
pi-linear-tools --help
```

## GitHub release

```bash
git tag v0.1.0
git push origin v0.1.0
```

Create release notes from `RELEASE_NOTES_v0.1.0.md`:

```bash
gh release create v0.1.0 --title "v0.1.0" --notes-file RELEASE_NOTES_v0.1.0.md
```

Verify release:

```bash
gh release view v0.1.0
```

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

## GitHub release (if required)

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then create a GitHub release using the notes in `CHANGELOG.md`.

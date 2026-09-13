# Release v0.8.2

**Corrective patch aligning the npm package with the GitHub release contents.**

## Fix

The npm artifact now includes the normalized Linear tool error handling introduced in the release source:

- Non-rate-limit failures include a consistent operation prefix.
- The original error is preserved as `cause`.
- Linear error types are preserved for diagnostics.

This makes the npm package match the code shipped in the GitHub release line.

## Verification

The release check passes, and the packed npm artifact contains the normalized error wrapper in `extensions/pi-linear-tools.js` and cause/type preservation in `src/linear.js`.

## Contributor credits

The Linear document functionality carried into this corrective release was contributed by [@dgalarza](https://github.com/dgalarza) (Damian Galarza) in [PR #36](https://github.com/fink-andreas/pi-linear-tools/pull/36).

---

**npm package:** `@fink-andreas/pi-linear-tools`
**git tag:** `v0.8.2`

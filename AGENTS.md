# Project-specific agent instructions

- Run `npm test` with `tail` to keep output shorter (for example: `npm test | tail -n 15`).

## Linear GraphQL API Schema

Use the official GraphQL schema as reference when working with Linear SDK/API:
- **Local copy:** `docs/linear-schema.graphql`
- **Source:** https://raw.githubusercontent.com/linear/linear/refs/heads/main/packages/sdk/src/schema.graphql

## Live extension testing (install/remove + restart)

Important behavior observed in practice:
- `/reload` updates already-loaded extension code changes.
- `/reload` does **not** reliably apply extension source add/remove.
- After `pi remove ...` or `pi install ...`, fully restart pi (close and reopen) before validation.

Use this order when reinstalling locally:

1. List installed extensions:
   - `pi list`
2. Remove existing `pi-linear-tools` source(s):
   - `pi remove <source>`
3. Install local extension from current working directory:
   - `pi install .`
4. Restart pi (close and reopen session).
5. Run `/reload` (optional but recommended after restart).
6. Re-run live tool checks.

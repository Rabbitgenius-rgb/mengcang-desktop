# Local preview migration

Run this tooling from the canonical 梦藏 source project. It has no network access and never executes source HTML or the preview's JavaScript. Inputs and output bundles contain private user data; keep bundles outside the repository, with local-only permissions. No credentials or original content belong in fixtures or logs.

```sh
node scripts/desktop-migration/cli.cjs plan --preview /path/to/old-preview/.local --vault /path/to/vault --out /path/to/new-private-plan
node scripts/desktop-migration/cli.cjs test-copy --plan-bundle /path/to/new-private-plan --out /path/to/new-test-vault
node scripts/desktop-migration/cli.cjs plan --preview /path/to/old-preview/.local --vault /path/to/new-test-vault --out /path/to/test-plan
node scripts/desktop-migration/cli.cjs apply --bundle /path/to/test-plan --vault /path/to/new-test-vault
node scripts/desktop-migration/cli.cjs verify --bundle /path/to/test-plan --vault /path/to/new-test-vault
node scripts/desktop-migration/cli.cjs restore --bundle /path/to/test-plan --vault /path/to/new-test-vault
```

`plan` generates `plan.json` (reviewed hash, input hashes, exact source-to-target mappings, statuses, expected target hashes), a human-readable `report.md`, and payload files keyed by SHA-256. Existing bundles cannot be overwritten. `inspect` is an alias for generating this local plan; it never changes the Vault. Four existing linked notes are reused byte-for-byte, so user captions and the unverified quotation source remain unchanged. Snapshot status is preserved independently from screenshot existence. An unassociated snapshot is retained only as an original/cache record, not a new material card.

`test-copy` copies only the existing files touched/reused by the exact plan, not the whole Vault or external books. Plan again against the test-copy path before applying. Apply refuses a plan made for another Vault. Every input and target must still have its reviewed hash. A known output hash permits retrying an interrupted apply, with a backup already recorded. Unexpected edits cause an error before mutations; after an interruption rerun the same plan. Do not edit affected notes concurrently with migration. Run application interaction/concurrency tests separately through the connector's Vault.process implementation.

Before applying, read the generated report, resolve any conflicts, and retain the plan bundle. `backup/manifest.json` records exact before/after hashes and copies of every replaced file before writes begin. Restore validates all files before restoring anything; if the user has edited a file after migration it refuses to overwrite that work. It does not delete empty directories. Copy backup bundles to a durable, private backup location before production installation.

A new plan after a successful migration reuses the migration index and current notes. User edits, moved notes with the same identity, and subsequently revoked relationships are not overwritten. Changed original inputs or purpose decisions require a separately reviewed incremental migration; they cannot silently replace already organized content. Title similarity never merges notes. Original versions and attachment IDs/hashes identify duplicates.

If a recoverable old-browser export is available, pass `--browser-export FILE`. It must be a JSON object with `schema: "mengcang.preview-state-export.v1"`, `exportedAt`, `basePreviewHash` (the exact source preview JSON hash), and `state` arrays. Without a verifiable export the report explicitly lists browser-memory-only changes as unrecovered. No confirmation is inferred from discussion or file age. Pending relationships are imported as `relation_candidates`; only confirmed relationships receive existing star-sea managed blocks at both endpoints.

The imported project notes intentionally omit lifecycle status, tasks and progression. Their goals remain empty. The project registry's unknown fields are retained, and source note links are explicit. A counts-only `log.md` entry satisfies the Vault's ingest-log rule; no source excerpts or run logs are placed in long-term memory.

Test with `node --test tests/desktop-migration.test.js`. Production install must additionally back up the plugin and app, verify the running Vault identity, and validate the installed UI. Those steps are owned by the desktop installation workflow, not this migration CLI.

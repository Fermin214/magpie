# AgentHub favorites in the magpie fork

Favorites adds one navigation entry beside Library, with Prompts and
Repositories tabs. It saves personal text and links; it never distributes them
to agents, clones a repository or changes Library content.

## Ownership and contracts

- `internal/agenthub/favorites` owns the schema, validation, import and storage.
- `internal/gui/agenthub_favorites.go` registers management routes beneath
  `/api/agenthub/favorites`. They share the existing GUI / authenticated web
  handler, not the model gateway or MCP server.
- `agenthub-favorites.js` owns all page state. The host only calls `enter`,
  `leave` and `relabel`. Leaving while saving is refused; dirty drafts require
  confirmation. Older reads cannot replace a newer navigation or mutation.
- `agenthub-favorites.css` is scoped to the page and uses magpie's theme tokens.
- Every mutation returns a complete `Snapshot`; errors never become snapshots.
  Writes require an explicit revision and modify only the requested record.
  Conflicts keep the draft and require explicit reload. A save in flight disables
  further writes and editing. A failed refresh retains the last snapshot but
  disables writes until a successful read.
- The desktop sidebar and header navigation share the Favorites entry, including
  its icon, translated label, active state and unsaved-draft guard. Resizing or
  toggling the sidebar keeps the open editor. The tray panel and gateway-only
  view do not add a Favorites entry.

## Files and recovery

The file is `<settings.Dir()>/agenthub/favorites.json`, independent of
`library.json`, settings and credential data. Schema 1 contains a revision,
prompts and repositories. Limits: 16 MiB total, 20,000 entries, 1 MiB per prompt
body, 50 tags per entry. Repository links must be credential-free HTTP(S).
GitHub URL matching ignores case, query, fragment, trailing slash and .git.

Cross-process OS locks serialize writers before re-reading and comparing the
revision. The prior validated file is saved to `favorites.json.bak` before
atomic primary replacement. Lock failures, read/parse failures and unknown
schemas refuse writes. No automatic recovery can replace the original with an
empty list. The OS releases the lock if a process exits; its lock file remains.

To recover manually, stop every magpie process using this config, preserve the
broken primary under another name, and copy the checked backup into its place.
Do not run an older build over a newer schema; it will refuse to write.

Favorites is not included in magpie's WebDAV/S3/standard backup bundle. Use
Favorites -> Import / export -> Export JSON for all data. Markdown exports only
prompt titles and bodies and is not a metadata backup.

## Import

Import previews do not write files. Commit revalidates the original input and
the data revision. Existing IDs and normalized repository URLs are kept; the
preview names up to 20 skipped entries and reports the full count. Imports are
additive, never a replacement or an implicit overwrite. Exported schema-1 JSON
round-trips. AgentHub's prompt-only JSON array is accepted too.

For an existing AgentHub database, close AgentHub or use a consistent SQLite
backup, then explicitly run with Node 22.13+:

```powershell
node build/agenthub-export.mjs C:\path\agenthub.sqlite3 C:\path\favorites.json
```

This opens the database read-only, refuses to overwrite output, and exports only
prompts and repository bookmarks. Original IDs, text, categories, tags, dates,
pin/status/archive fields are retained. Legacy project IDs remain provenance,
not references to magpie's project deployment system. Import the JSON in
Favorites and inspect its preview. The original database is never modified.

## Build and update

```powershell
pwsh -File build/agenthub-build.ps1
# Or supply a portable Go installation:
pwsh -File build/agenthub-build.ps1 -Go C:\tools\go\bin\go.exe
```

The Windows amd64 output is `dist/magpie-agenthub.exe`, with a commit/dirty-state/
SHA-256 receipt. The version is deliberately `agenthub-<sha>[-dirty]`, not
semver. Upstream `update.Released` then refuses official replacement in GUI
and CLI. Do not override it with a release-shaped version. The fork does not
modify update internals or publish releases automatically. Installing an
official binary manually still removes the feature; independent data remains.

Use `upstream` for yetone/magpie and `origin` for this fork. Keep main as an
upstream mirror, and work on `codex/agenthub-favorites`. Upgrade on a temporary
sync branch by merging the selected upstream release, then run the checks below
before merging back. Avoid rebasing a shared feature branch.

## Upstream integration checklist

Only these existing implementation files need feature hooks:

| File | Contract to recheck after merging upstream |
| --- | --- |
| assets/index.html | Grouped sidebar/header navigation with icon and translated span, hidden view, root-level versioned JS/CSS; script loads before app.js |
| assets/app.js | View title/list, initial URL, load, leave guard, locale refresh, gateway-only exclusion |
| assets/i18n.js | Favorites strings in every supported locale |
| api.go | Route registration inside the management handler |

Do not inject a tab with DOM observers, monkey-patch navigation or rewrite the
upstream router into a plugin framework. Root-level prefixed assets work with
`versionedPage` without changing its filename matcher. Data modules must not
import Library/provider/gateway packages. Keep business changes separate from
integration and build changes when reviewing the fork.

## Verification

Use the Go version in go.mod. Pin GOPATH/GOMODCACHE/GOCACHE before isolating the
test home; follow docs/code-standards.md for the full upstream checks.

```text
go test -tags nogui ./internal/agenthub/favorites ./internal/gui -run "Test(SaveConflict|InvalidRead|ConcurrentStores|ImportPreview|AgentHubFavorites)"
go test ./internal/update -run TestAgentHubBuild
node --test internal/gui/tests/agenthub-favorites.test.cjs build/agenthub-export.test.cjs
make test-ui
```

The UI test uses real magpie assets, real serialization shapes and fictional API
data in Chromium and WebKit, Chinese and English. It covers create/save/copy,
repository editing, import preview and commit, JSON export, narrow layout,
navigation cancellation, failed saves/refreshes, duplicate submits, revision
conflicts and old reads completing after navigation. It also checks desktop
sidebar/header switching, narrow windows and reloading with an open Favorites
page. Backend tests cover actual
files, backup failure, corruption/new schema, concurrent stores and read-only
preview. The GUI route test goes through Handler and webGuard.

Set MAGPIE_ASSETS to an unmodified upstream assets directory to run the same
entry test against BASE: it fails because the Favorites entry is absent, rather
than because code cannot compile. Browser fixtures do not replace an isolated
native WebView2 run. Never launch test builds with the user's live config,
credentials, gateway or agent files.

The fork adjusts only the desktop pixel comparison in `mobile-web.test.cjs`:
it hides the intentional Favorites tab on both comparison pages, leaving the
existing 300-pixel threshold unchanged. Actual Favorites navigation and narrow
layout are checked separately. Keep this exception when comparing to upstream.

See [the initial validation record](agenthub-validation.md) for passed checks,
known upstream failures and checks that remain incomplete before a release.

# Favorites validation — 2026-10-11

This is a local preview, not a release or a claim that the complete upstream
suite passes. Upstream BASE is `189586612eea57b195f004d360a4b8a8d278dc71`.
No live magpie settings, credentials, Agent files or gateway were used for
functional checks. Test values were fictional.

## Passed

- Windows Go vet for all packages; Linux vet with `nogui`.
- Windows production build and Linux `nogui` build.
- Favorites store tests: stale revisions, concurrent writers, preservation of
  unrelated records, exact prior-file backup, backup failure, malformed/newer
  data refusing writes, additive imports and read-only preview.
- Actual management-handler tests: serialization, persistence, missing revision,
  conflict status and rejection of unauthenticated web access.
- Official replacement protection: fork source versions are not release versions.
- Read-only AgentHub SQLite exporter: released field shapes, exact text and
  metadata, unchanged source bytes and refusal to overwrite an export.
- Favorites flows in Chromium and WebKit, English and Chinese: create, save,
  copy, repositories, JSON import preview/commit, JSON export, narrow layout,
  navigation cancellation, failed saves/refreshes, duplicate submits, concurrent
  changes and stale reads.
- Mobile-web layout and original-page desktop pixel comparisons in both engines,
  English and Chinese; the deliberate new navigation tab is excluded only from
  the before/after pixel comparison. Favorites dark/light styling was inspected.
- Translation completeness, placeholders and duplicate-key checks for
  Simplified/Traditional Chinese, Japanese and German; language-window tests.
- Real Windows WebView2: opening Favorites, entering Chinese title/body,
  saving to an isolated portable directory, refreshing and reading it back,
  and downloading JSON with the same text and metadata.

The same navigation test against BASE fails with
`Favorites entry must be present in magpie's real navigation`, not a compile
failure. Native testing also found clean-editor focus loss after the window
regained focus. The added regression failed before the fix and passed after it.
The focus refresh now skips an open editor.

## Whole-suite status

`go test -tags nogui ./...` completed with exit 1 on Windows. Failed packages:
root CLI, agent, backup, edit, gateway, gui, library, profile, provider, sessions,
testenv and usage. Failures include POSIX file-mode assumptions, unavailable
symlink privilege, cleanup failures, package-wide 10-minute timeouts and other
assertions. This result is not waived by the focused passes.

`TestAsideOfflineLegacyRecordDoesNotResurrect` also fails on BASE with the
Windows file-mode assertion in `aside_offline_test.go:292`.
`TestAlmaServerKeyed` failed during the broad run but passed alone on BASE;
its broad-run failure has not been isolated or attributed.

The full GUI command (`node --test --test-concurrency=2
internal/gui/tests/*.test.cjs`, 496 files) was started, then deliberately stopped
after confirmed existing failures. It was **not completed**. In both current
code and BASE, `agent-disconnect-preview.test.cjs` fails because its “no config
writes” assertion also counts the existing `/api/window/titlebar` POST. The
feature does not change that endpoint or the disconnect preview. Additional
full-suite failures may remain.

Local raw logs are under the ignored `.agenthub-work/` directory:
`go-all.log`, `ui-all.log`, `disconnect-base.log`,
`go-base-permissions.log`, `go-focused-final.log`,
`focused-ui-final.log`, `migration.log` and `navigation-final.log`.
The combined navigation log includes two temporary Favorites test-setup failures
(the dark-theme switch omitted the test language). After correcting that fixture
and waiting for the theme transition, `favorites-final.log` reports all four
Favorites tests passing. Both mobile-web groups in the combined log passed.
Build receipts record the exact commit and SHA-256 of each local executable.

## Release boundary

Do not treat this preview as release-accepted. Before adopting it as a
distributed release, resolve or independently track the upstream failures and
finish the complete GUI suite on the final source. Native checks did not cover
installer lifecycle, macOS/Linux native GUI, or a restart of the entire
process with production data. No installer or GitHub Release was published.

## Upstream sync - 2026-10-12

Merged upstream `v0.1.1203` (`6c1c0a74`) onto the Favorites fork, bringing
in 125 upstream commits since `1cb136ec`. Favorites now uses the upstream
sidebar/header navigation structure: an icon and translated label beside
Library, with the existing active state, reload and unsaved-draft protection.
The skill-control alignment and custom-build replacement protection remain.

Passed on the merged source:

- Windows `go vet ./...` and full test compilation (`go test -run '^$' ./...`).
- Linux `nogui` vet and build; Windows production build.
- Sandboxed Favorites storage, management-handler and custom-build protection
  checks, plus the read-only AgentHub exporter.
- Eighteen focused GUI files covering Favorites, skill controls, sidebar
  switching/resizing, headers, gateway mode, translation completeness and
  language switching, Library loading/instruction writes/MCP tools, and click
  scrolling. They exercise Chromium and WebKit and the five supported locales
  where their existing fixtures provide them.

The initial GUI run passed 209 of 219 checks. Its ten failures were the new
sidebar fixture and upstream navigation assertions that did not yet include
Favorites. After correcting those fixtures and navigation expectations, all
17 checks in the five affected files passed. The other thirteen files were
not repeated. The new sidebar check also fails on the prior fork
assets with `Favorites opens in the desktop sidebar`.

Raw logs are retained in the original checkout's ignored `.agenthub-work/`:
`sync-ui.log`, `sync-ui-final.log`, `sync-ui-before.log`, `sync-go.log`,
`sync-vet-windows.log`, `sync-vet-linux.log`, `sync-compile-windows.log`,
`sync-build-windows.log` and `sync-build-linux.log`.

This is a source/fork sync with a local build. The complete Go and GUI execution
suites, native WebView2 runtime, real providers and installer lifecycle were
not rerun. No live gateway/configuration was changed and no release was made.

## Local Prompt update and upstream sync - 2026-10-13

Merged upstream `v0.1.1223` (`2810a715`) into the Favorites fork. Prompt
and repository cards use two columns when the window has room. Selecting a
card opens the shared detail dialog; its fields scroll while the action
buttons remain visible. Closing it restores the card focus and list position.

The Favorites checks passed in Chromium and WebKit, covering bottom-of-list
selection, narrow and short windows, saving, errors, keyboard focus, and
unsaved changes. Related sidebar, Library/export, storage, management-handler
and custom-build protection checks passed on the merged source. Native Windows
WebView2 verification also passed for cards, detail scrolling, saving and
unsaved changes. Evidence is retained under `.agenthub-work/`, including
`native-prompt-results.json`, `native-prompt-cards.png`,
`native-prompt-dialog.png`, `prompt-sync-favorites-final.log` and
`prompt-sync-sidebar-final.log`.

Acceptance is scoped to the local Favorites change and its upstream
integration. Unrelated upstream source and test changes were reverted.
The Windows custom-build version continues to prevent replacement by the
official updater. The local executable and configuration are backed up before
replacement; deployment receipts record the final executable and Favorites
hashes. No PR, installer or public release is part of this change.

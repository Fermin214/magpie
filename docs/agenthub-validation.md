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

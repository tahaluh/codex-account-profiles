# Changelog

All notable changes to Codex Account Profiles are documented here.

## 0.4.0

- Add a reset planner comparing every account's next quota-window reset, last observed renewal, and available banked resets, with dates in the local timezone.
- Add account ordering by next reset or remaining quota while preserving manual account selection.
- Display grant and expiry dates for banked reset credits when Codex supplies their details.
- Apply a selected banked reset through the official Codex account RPC after explicit account-specific confirmation; show authoritative results and refresh limits afterward.
- Persist idempotency keys for uncertain reset attempts so retrying after a timeout or VS Code restart cannot consume a second credit. Pending attempts remain visible even when the displayed balance becomes zero.
- Track account-local quota renewals and successful redemption confirmations in a bounded history. Observed renewals carry a time interval rather than an invented exact reset timestamp; the first observation never fabricates past history.
- Add a separate external link to the public Codex reset tracker for global announcements. Account data is not submitted to that tracker.
- Mark elapsed reset dates as needing a refresh instead of displaying a misleading countdown.
- Serialize overlapping profile-view refreshes and preserve expanded history/credit details during background updates.

## 0.3.18

- Fix account switches timing out or reverting because a closed, empty, or paginated conversation failed a full-history preflight check.
- Resume conversations with metadata-only `excludeTurns: true`; defer missing rollouts, and recreate only empty sessions on demand while preserving client thread identity.
- Remove quota probes from manual switches so a slow or unavailable quota endpoint cannot block changing accounts.
- Cancel outstanding read-only queries during a switch and forward server-initiated requests and client replies during restoration.
- Correlate switch results with unique request IDs, publish launcher heartbeat/progress, show waiting versus switching, and clear abandoned pending states with actionable errors.
- Discover launchers started before extension activation using their owning extension-host PID, and retain selected accounts across restarts.
- Select the next account immediately when Codex is not running, instead of leaving an unconsumed request pending.
- Handle terminal turn-start responses, drain quota-client diagnostics, clean RPC listeners, and bound optional background token refresh.
- Add regression coverage for empty tabs, metadata-only restoration, hung quota reads, request correlation, restoration elicitation, and stale pending state; include an offline smoke test against the installed Codex binary.

## 0.3.17

- Keep credentials in each account home while sharing conversation files, user configuration, and the Codex SQLite directory; concurrent VS Code windows no longer hold a global authentication lock.
- Separate runtime status, account selection, and switch requests per VS Code window.
- Restore newly created and forked conversations as well as resumed conversations after a profile switch.
- Wait for every conversation restoration acknowledgement, report restoration failures, and recover the previous account instead of reporting a false success.
- Verify that conversations are saved before stopping a backend; an unsaved empty conversation cancels the switch while keeping its live backend available.
- Release pending turns when `turn/start` is rejected and track concurrent turns by request, thread, and turn identifiers.
- Open terminal sessions through the same launcher and shared history as the IDE integration.
- Preserve pre-existing account-local history/configuration in `.before-shared-*` backups and leave global credentials untouched.
- Use ephemeral startup probes and force file-based credential storage for managed logins and quota probes.
- Add integration regressions for continuing conversations, delayed/failed restoration, rejected turns, multiple windows, terminal launches, and history preservation.

## 0.3.16

- Run add-account and re-authentication launchers in Electron's Node mode so VS Code Snap installations do not initialize graphics drivers in the login terminal.
- Clear `ELECTRON_RUN_AS_NODE` before starting Codex so the login browser and other child processes inherit a normal environment.

## 0.3.15

- Install the native Codex launcher at a stable global-storage path and repair obsolete versioned extension paths after upgrades.
- Migrate legacy `codexAccountSwitcher` preferences so automatic switching remains enabled after the settings namespace change.
- Read and display an account's quota immediately after a successful add-account login.
- Keep manual and automatic account switches queued until the active Codex turn reports `turn/completed`.
- Verify each saved profile against its isolated authentication home when reading identity and quota data.

## 0.3.14

- Wait for the previous backend to exit before changing the shared authentication link.
- Restart an unexpectedly exited backend behind the persistent proxy connection.
- Reload account and switching settings while a Codex session is running.
- Keep queued switches visible until the launcher confirms success or failure.
- Deduplicate concurrent quota requests and preserve unrelated cache updates.
- Ask before enabling native integration and allow restoring the previous CLI setting.
- Avoid replacing unchanged account view HTML during background refreshes.
- Remove unused threshold and backend-restart settings.

## 0.3.13

- Split account view behavior, HTML rendering, quota presentation, and extension state types into focused modules.
- Add presentation and webview template regression tests without changing account selection or turn-boundary behavior.

## 0.3.12

- Restore the original Marketplace identifier so upgrades retain extension state and replace earlier versions.
- Recover profiles created by the temporary 0.3.11 extension identifier when needed.
- Preserve live authentication locks until the owning process exits.
- Require a confirmed rate-limit event and completed turn before switching accounts automatically.
- Delete managed local authentication data when a profile is removed.
- Add a nonce-based webview content security policy and render imported names as text.
- Process manual backend switches while Codex is idle and recover cleanly if a replacement backend fails to start.
- Keep the reset summary focused on available reset credits and remove the general next-reset line.
- Tighten the More menu alignment and dropdown presentation in the account toolbar.

## 0.3.8

- Run Codex login through the extension launcher so stale auth homes can be repaired before credentials are saved.

## 0.3.6

- Rename the Marketplace extension identifier to `tahaluh-codex-account-profiles`.
- Rename contributed command and settings namespaces to `codexAccountProfiles`.
- Rename the bundled launcher to `codex-account-profiles`.

## 0.3.5

- Simplify the account dashboard header and card layout.
- Hide export and backup import under the secondary menu.
- Remove the top summary cards and keep the current account first in the list.

## 0.3.4

- Fix launcher fallback storage so Codex always reads the published extension's account registry when VS Code does not pass runtime env.
- Add proxy-side cooldown after a quota exhaustion event to prevent rapid switching between the same accounts.

## 0.3.3

- Stop prompting to reload VS Code on shared `auth.json` changes.
- Keep dashboard and status bar sync silent so proxy auth swaps do not create alert loops.

## 0.3.2

- Tighten dashboard spacing for account identity, usage meters, reset times, and metadata.
- Shorten quota reset labels in compact metric cards.

## 0.3.1

- Replace the compact account list with a dashboard-style view.
- Add active-account summary, account counts, availability counts, usage meters, and expandable quota details.
- Add dashboard quick actions for refresh, add account, import current auth, backup import/export, and settings.
- Show per-account quota cache age and token refresh state in the dashboard.

## 0.3.0

- Add `Codex: Re-authenticate Profile` for refreshing an existing saved profile through `codex login`.
- Detect external shared `auth.json` changes and prompt to reload VS Code when Codex may need to re-read auth state.
- Add experimental background OAuth token refresh for saved profiles with refresh tokens.
- Load proxy settings from `CODEX_HOME/.env` for Codex-related extension workflows.
- Add separate automatic switch thresholds for 5-hour and weekly quota windows.
- Apply the existing cooldown setting when selecting fallback accounts after quota exhaustion.
- Add Node test coverage for proxy parsing, JWT expiry, and quota threshold behavior.

## 0.2.0

- Add a status bar item showing the active Codex account and cached quota.
- Add `Codex: Import Current Profile` for adopting an existing global `auth.json`.
- Add JSON account backup import and export commands with token safety warnings.
- Reuse quota results across VS Code windows through a shared local cache.
- Refresh saved account quotas one profile at a time in the background.
- Add auth locking and atomic runtime writes in the launcher.
- Keep queued backend switches reflected in the account view and status bar.

## 0.1.4

- Rename the GitHub repository to `codex-account-profiles`.
- Update package metadata and support links to the new repository URL.

## 0.1.3

- Improve Marketplace and GitHub documentation.
- Add open source contribution and security guidance.
- Clarify local authentication handling, shared chat behavior, and responsible use.
- Update package metadata for discoverability.

## 0.1.2

- Rename the Marketplace display name to `Codex Account Profiles`.

## 0.1.1

- Publish under the `tahaluh` Marketplace publisher.
- Use a Marketplace-safe extension identifier.
- Keep Codex chats and sessions in the shared Codex home while switching only account authentication.
- Move account switch confirmation into the extension view.

## 0.1.0

- Initial release.
- Add local Codex account profile management.
- Add quota-aware account selection.
- Add VS Code commands and Activity Bar view for Codex accounts.
- Add launcher script for integrations that accept a custom Codex executable.

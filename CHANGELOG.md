# Changelog

All notable changes to Codex Account Profiles are documented here.

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

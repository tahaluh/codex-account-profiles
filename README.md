# Codex Account Profiles - Live Switch

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/tahaluh.tahaluh-codex-account-switcher?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=tahaluh.tahaluh-codex-account-switcher)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex Account Profiles is a VS Code extension for developers who use more than one authorized Codex account or local Codex profile.

It lets you add accounts with the official `codex login` flow, view quota signals returned by Codex, and choose which authenticated profile should be used by the Codex VS Code integration. Chats and session history stay in the shared Codex home while authentication is switched per selected profile.

## Why This Exists

Codex stores local state under `CODEX_HOME`. That is useful for isolated profiles, but it can also split chat history when all you want is to switch authentication. This extension keeps account credentials isolated while preserving a common Codex workspace experience.

Typical uses:

- Keep personal, work, and client Codex accounts separate.
- See available rate-limit windows before choosing a profile.
- Switch the active Codex account from a VS Code Activity Bar view.
- Keep Codex chats and sessions available across profile changes.

## Features

- Add accounts through the official `codex login` browser flow.
- Store each account credential in an isolated local profile.
- Keep Codex chats and session history in the shared Codex home.
- Show known short and weekly rate-limit windows when Codex exposes them.
- Show the active account and cached quota in the VS Code status bar.
- Use a dashboard view with active-account summary, usage meters, quota details, and account actions.
- Switch accounts from a dedicated Activity Bar panel.
- Confirm account switches inline inside the extension view.
- Switch the active Codex backend without reloading VS Code, after the in-flight turn reaches a terminal state.
- Refresh saved account quotas in the background one account at a time.
- Reuse recent quota checks across VS Code windows through a shared local cache.
- Import the current global Codex `auth.json` as a managed profile.
- Re-authenticate a saved profile without deleting it.
- Export and import JSON backups for trusted local storage.
- Detect external `auth.json` changes and prompt to reload when the current Codex session may need it.
- Load Codex proxy variables from `CODEX_HOME/.env` for extension and launcher workflows.
- Optionally refresh saved OAuth tokens in the background when a refresh token is present.
- Optionally switch to another enabled profile only after a confirmed rate-limit event, waiting for the current message to finish.

## Reset planner and history

The profile view compares all saved accounts in one reset planner. It shows the next reported window reset, the most recent account-local reset observation, and the banked reset balance. Each account card retains all reported window dates and includes banked-credit grant/expiry details when Codex returns them. Dates use your local timezone.

Choose **Next reset first** or **Most quota first** from the Order menu, then use the account's normal switch button. Sorting changes the view; it never switches accounts automatically. The earliest window reset does not necessarily restore every account limit. Passed reset timestamps are marked as needing a quota refresh.

**Use a banked reset…** lets you choose an available reset, see its expiry, and confirm the exact account before spending it. If Codex only reports the balance, the service chooses the next available credit. Nothing is redeemed automatically. Codex reports whether a reset was applied, already redeemed, unnecessary, or unavailable; the extension then reads the official limits again. A network failure retains the same redemption key on disk so **Check / retry previous reset…** verifies the same attempt rather than spending another credit. That retry remains accessible even if the banked balance subsequently reads zero.

Reset history is stored locally per account in `profile-reset-history.json`, limited to 50 events. Observed quota renewals require both increased remaining quota and a forward window-boundary change. They are labeled with the observation interval, because polling cannot establish an exact historical reset time. The first quota observation establishes a baseline and creates no past events. Successful redemptions performed through the extension are recorded separately. History begins when this version checks the account and does not reconstruct resets from before installation.

The **Public reset tracker** button opens the independent Codex reset tracker in your browser for global announcements. That site is separate from your account's observed history; the extension does not scrape its data, send it credentials or account details, or claim a predicted global reset time.

## Installation

Install from the Visual Studio Marketplace:

https://marketplace.visualstudio.com/items?itemName=tahaluh.tahaluh-codex-account-switcher

Or install a local VSIX build:

```bash
npm install
npm run package
code --install-extension tahaluh-codex-account-switcher-0.4.0.vsix
```

## Getting Started

1. Install the official OpenAI Codex VS Code extension.
2. Install Codex Account Profiles.
3. Open the VS Code Command Palette.
4. Run `Codex: Add Account Profile`.
5. Complete the official `codex login` flow in the browser.
6. Give the account a local nickname.
7. Open the `Codex Profiles` Activity Bar view and select the profile to use.

The extension asks before configuring the Codex extension's CLI executable setting to use its launcher. The previous global value is preserved and can be restored with `Codex: Disable Native Integration`.

## Commands

| Command | Description |
| --- | --- |
| `Codex: Add Account Profile` | Add a new Codex profile through `codex login`. |
| `Codex: Import Current Profile` | Import the current global Codex `auth.json` as a managed profile. |
| `Codex: Re-authenticate Profile` | Run `codex login` again for a saved profile. |
| `Codex: Export Profiles` | Export saved local account profiles to a JSON backup. |
| `Codex: Import Profiles` | Import saved account profiles from a JSON backup. |
| `Codex: Remove Profile` | Remove a saved local profile entry. |
| `Codex: Show Profile Limits` | Show cached quota information for saved profiles. |
| `Codex: Switch Profile` | Pick the account used by the next Codex session. |
| `Codex: Start with Available Profile` | Start Codex in a terminal with an available profile. |
| `Codex: Enable Native Integration` | Point the Codex extension at the account profiles launcher. |
| `Codex: Disable Native Integration` | Restore the previous global Codex CLI executable setting. |
| `Codex: Open Launcher Folder` | Reveal the installed extension folder. |

## Settings

| Setting | Default | Description |
| --- | ---: | --- |
| `codexAccountProfiles.autoSwitch` | `false` | After a confirmed exhausted-limit event and terminal turn state, switch when another account is fully available. |
| `codexAccountProfiles.startupSelectionMode` | `2` | `1` reads quotas only; `2` sends the startup probe to each account before selecting the account with the most remaining quota. |
| `codexAccountProfiles.startupProbePrompt` | `Reply with OK.` | Prompt used once per account when startup selection mode is `2`. |
| `codexAccountProfiles.confirmBeforeSwitch` | `true` | Ask before changing the selected profile in command flows. |
| `codexAccountProfiles.minimumRemainingPercent` | `1` | Minimum remaining quota required for a profile to be considered available. |
| `codexAccountProfiles.cooldownMinutes` | `10` | Minutes to avoid retrying a profile after a rate-limit failure. |
| `codexAccountProfiles.cacheTtlSeconds` | `60` | How long cached rate-limit data may be reused. |
| `codexAccountProfiles.refreshIntervalSeconds` | `60` | How often enabled account limits are refreshed in the background. |
| `codexAccountProfiles.showStatusBar` | `true` | Show the active Codex account and cached quota in the status bar. |
| `codexAccountProfiles.accountSortOrder` | `current` | Order profiles by current account, next reset, or remaining quota. |
| `codexAccountProfiles.backgroundTokenRefresh` | `false` | Experimentally refresh saved OAuth access tokens in the background when possible. |

## How It Works

Each added account receives its own profile directory under VS Code global storage. Codex writes that profile's `auth.json` through its normal login flow.

When Codex is launched through this extension's launcher:

1. Codex starts in the selected account's own home, so credentials stay isolated and token updates stay with that account.
2. Conversation folders and user configuration link to the shared Codex home (`~/.codex`, or `CODEX_SHARED_HOME`). Codex's `sqlite_home` points to the same shared directory. Terminal launches use this same history.
3. Each VS Code window has its own runtime status and switch-request directory. No session-long global authentication lock is needed, and global `auth.json` is never replaced.
4. At a safe turn boundary, the launcher stops the old backend to release Codex's conversation writer locks and resumes conversations in the new backend using metadata-only responses. It does not load full chat histories or check quotas to perform a manual switch. If restoration encounters a substantive error, the previous account is recovered.

An empty or closed tab without a saved rollout no longer cancels the whole switch. Missing conversations are deferred until used; empty sessions are recreated on demand with their original client identity. A conversation with accepted user turns is never replaced by an empty session. If its history is unavailable, the request reports an error and asks you to reopen it from history. Pre-existing account-local conversation/configuration paths are preserved as `.before-shared-*` backups when shared links are first installed. Different windows can use separate conversations concurrently; Codex's own writer lock still protects a conversation already open elsewhere.

The profile view distinguishes waiting for the current response from switching accounts. Each switch carries a unique request ID; stale results cannot complete a newer request. A disconnected launcher or a stalled switch clears pending with an actionable message. If Codex is closed, the choice is saved for its next session. After upgrading from 0.3.17, reload the VS Code window once so the running launcher adopts the new protocol.

These account profiles manage authentication homes. Codex CLI `--profile` configuration layers are a separate feature.

The extension does not print or upload token contents. Authentication stays on the local machine and is handled by the official Codex CLI. Account backup files intentionally contain local auth data, so only export them to trusted storage and do not share them.

Background token refresh is disabled by default. When enabled, the extension uses the saved local OAuth `refresh_token` from the account profile and writes the refreshed token back to that same local `auth.json`.

## Responsible Use

This project is intended for managing local profiles that you are authorized to use. It is not intended to bypass provider policies, account limits, or terms of service. Use only accounts and organizations where you have permission to run Codex.

## Development

Requirements:

- Node.js 22 or newer
- VS Code 1.96 or newer
- The Codex CLI available as `codex`

Local workflow:

```bash
npm install
npm run compile
npm test
npm run test:native  # optional: installed Codex binary, synthetic history, no model prompts
npm run package
```

The extension entrypoint is `src/extension.ts`. The launcher used by the Codex integration is `bin/codex-account-profiles`.

## Contributing

Issues and pull requests are welcome. Please keep changes focused, describe the behavior being changed, and avoid including account data, tokens, logs with secrets, or `auth.json` contents.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Security

If you find a security issue, please do not open a public issue with secrets or exploit details. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

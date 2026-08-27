# Codex Account Profiles

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
- Queue backend switches for the next Codex request.
- Refresh saved account quotas in the background one account at a time.
- Reuse recent quota checks across VS Code windows through a shared local cache.
- Import the current global Codex `auth.json` as a managed profile.
- Re-authenticate a saved profile without deleting it.
- Export and import JSON backups for trusted local storage.
- Detect external `auth.json` changes and prompt to reload when the current Codex session may need it.
- Load Codex proxy variables from `CODEX_HOME/.env` for extension and launcher workflows.
- Optionally refresh saved OAuth tokens in the background when a refresh token is present.
- Optionally auto-select another enabled profile when quota is exhausted.

## Installation

Install from the Visual Studio Marketplace:

https://marketplace.visualstudio.com/items?itemName=tahaluh.tahaluh-codex-account-switcher

Or install a local VSIX build:

```bash
npm install
npm run package
code --install-extension tahaluh-codex-account-switcher-0.3.1.vsix
```

## Getting Started

1. Install the official OpenAI Codex VS Code extension.
2. Install Codex Account Profiles.
3. Open the VS Code Command Palette.
4. Run `Codex: Add Account`.
5. Complete the official `codex login` flow in the browser.
6. Give the account a local nickname.
7. Open the `Codex Accounts` Activity Bar view and select the account to use.

The extension configures the Codex extension's CLI executable setting to use its launcher. If needed, run `Codex: Enable Native Integration` from the Command Palette.

## Commands

| Command | Description |
| --- | --- |
| `Codex: Add Account` | Add a new Codex profile through `codex login`. |
| `Codex: Import Current Account` | Import the current global Codex `auth.json` as a managed profile. |
| `Codex: Re-authenticate Account` | Run `codex login` again for a saved profile. |
| `Codex: Export Accounts` | Export saved local account profiles to a JSON backup. |
| `Codex: Import Accounts` | Import saved account profiles from a JSON backup. |
| `Codex: Remove Account` | Remove a saved local profile entry. |
| `Codex: Show Account Limits` | Show cached quota information for saved profiles. |
| `Codex: Switch Account` | Pick the account used by the next Codex session. |
| `Codex: Start with Available Account` | Start Codex in a terminal with an available profile. |
| `Codex: Enable Native Integration` | Point the Codex extension at the account-switching launcher. |
| `Codex: Open Launcher Folder` | Reveal the installed extension folder. |

## Settings

| Setting | Default | Description |
| --- | ---: | --- |
| `codexAccountSwitcher.autoSwitch` | `false` | Automatically select another available profile when starting Codex. |
| `codexAccountSwitcher.confirmBeforeSwitch` | `true` | Ask before changing the selected profile in command flows. |
| `codexAccountSwitcher.minimumRemainingPercent` | `1` | Minimum remaining quota required for a profile to be considered available. |
| `codexAccountSwitcher.autoSwitchHourlyThreshold` | `1` | Switch away when the 5-hour quota reaches this remaining percentage. |
| `codexAccountSwitcher.autoSwitchWeeklyThreshold` | `1` | Switch away when the weekly quota reaches this remaining percentage. |
| `codexAccountSwitcher.cooldownMinutes` | `10` | Minutes to avoid retrying a profile after a rate-limit failure. |
| `codexAccountSwitcher.cacheTtlSeconds` | `60` | How long cached rate-limit data may be reused. |
| `codexAccountSwitcher.refreshIntervalSeconds` | `60` | How often enabled account limits are refreshed in the background. |
| `codexAccountSwitcher.showStatusBar` | `true` | Show the active Codex account and cached quota in the status bar. |
| `codexAccountSwitcher.backgroundTokenRefresh` | `false` | Experimentally refresh saved OAuth access tokens in the background when possible. |

## How It Works

Each added account receives its own profile directory under VS Code global storage. Codex writes that profile's `auth.json` through its normal login flow.

When Codex is launched through this extension's launcher:

1. The selected account's `auth.json` is linked into the shared Codex home while an auth lock is held.
2. Codex starts with the shared home so chats and sessions remain consistent.
3. The original shared `auth.json` is restored when the process exits.

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
npm run package
```

The extension entrypoint is `src/extension.ts`. The launcher used by the Codex integration is `bin/codex-account-switcher`.

## Contributing

Issues and pull requests are welcome. Please keep changes focused, describe the behavior being changed, and avoid including account data, tokens, logs with secrets, or `auth.json` contents.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Security

If you find a security issue, please do not open a public issue with secrets or exploit details. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

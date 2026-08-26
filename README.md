# Codex Account Switcher

Codex Account Switcher is a local VS Code extension for managing multiple authorized Codex profiles and selecting an account with available quota before starting a Codex session.

It is designed for users who legitimately have more than one authorized Codex account or profile and want a clearer way to keep those sessions isolated.

## Features

- Add Codex accounts through the official `codex login` flow.
- Store each account in its own isolated `CODEX_HOME` profile.
- Show known Codex rate-limit windows, including short and weekly windows when available.
- Select the best enabled account before launching Codex.
- Optionally switch automatically when starting a managed session.
- Provide a launcher script for integrations that accept a custom Codex executable path.

## Local Installation

```bash
cd /home/thaua/codex-account-switcher
npm install
npm run package
code --install-extension codex-account-switcher-0.1.0.vsix
```

After installing, open the VS Code Command Palette and run `Codex: Add Account`. The extension opens the official Codex login flow in your browser. Once login completes, it detects the authenticated email and asks for a nickname such as `Work`.

To start a managed session, run `Codex: Start with Available Account`.

## Configuration

The extension asks for confirmation before switching by default. To enable automatic switching, turn on `codexAccountSwitcher.autoSwitch` in VS Code settings.

Rate-limit data is cached in VS Code global storage for 60 seconds. The extension automatically refreshes enabled accounts every 60 seconds and shows each window returned by Codex, such as 5h and weekly windows. These values can be changed with `codexAccountSwitcher.cacheTtlSeconds` and `codexAccountSwitcher.refreshIntervalSeconds`.

Useful settings:

- `codexAccountSwitcher.autoSwitch`: automatically select another available profile when starting Codex.
- `codexAccountSwitcher.confirmBeforeSwitch`: ask before changing the selected profile.
- `codexAccountSwitcher.minimumRemainingPercent`: minimum remaining quota required for an account to be considered available.
- `codexAccountSwitcher.cooldownMinutes`: avoid retrying a profile for a period after a rate-limit failure.
- `codexAccountSwitcher.cacheTtlSeconds`: control how long cached rate-limit data may be reused.
- `codexAccountSwitcher.refreshIntervalSeconds`: control how often account limits are refreshed in the background.

## Account Profiles

The extension stores account names, `CODEX_HOME` paths, and preferences in VS Code global storage. The token is written by Codex itself into the isolated account profile. The extension does not copy or print `auth.json`.

The launcher in `bin/codex-account-switcher` can be used as the CLI executable in integrations that accept a launcher path. The official Codex extension may not accept this flow in some installed versions because its executable setting can be development-only.

## Limits and Responsible Use

Switching happens between sessions, not in the middle of an active request. All accounts must be authorized for the intended use and must follow provider rules, terms, and quotas.

This extension is not intended to bypass usage policies. It only helps manage local profiles that the user is already authorized to use.

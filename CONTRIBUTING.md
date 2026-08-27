# Contributing

Thanks for considering a contribution to Codex Account Profiles.

## Project Goals

This extension should stay focused on local Codex profile management:

- Keep account credentials isolated.
- Preserve shared Codex chats and session history.
- Make account selection clear inside VS Code.
- Avoid collecting, transmitting, or exposing authentication secrets.
- Prefer small, auditable changes over broad rewrites.

## Development Setup

```bash
npm install
npm run compile
npm run package
```

The main extension code lives in `src/extension.ts`.

The launcher used by the Codex integration lives in `bin/codex-account-switcher`.

Generated JavaScript in `dist/` is committed because VS Code loads the compiled extension entrypoint.

## Pull Requests

Before opening a pull request:

- Keep the change scoped to one behavior or fix.
- Run `npm run compile`.
- Update documentation when changing user-facing behavior.
- Do not include local profiles, `.vsix` builds, tokens, logs, or `auth.json`.
- Explain how the change was tested.

## Code Style

- Follow the existing TypeScript style.
- Avoid new dependencies unless they remove meaningful complexity.
- Keep authentication and filesystem behavior explicit and easy to review.
- Do not log secrets or full authentication payloads.

## Reporting Bugs

Open an issue with enough context to reproduce the problem. Include versions, platform, and the observed behavior. Redact account identifiers and private prompt content when possible.

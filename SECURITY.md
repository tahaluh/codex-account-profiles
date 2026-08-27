# Security Policy

## Supported Versions

Security fixes are provided for the latest published Marketplace version.

## Reporting a Vulnerability

Please do not open a public GitHub issue for vulnerabilities involving authentication, token handling, profile isolation, or secret exposure.

Report security concerns by opening a private advisory on GitHub if available, or by contacting the maintainer through the publisher profile:

https://marketplace.visualstudio.com/publishers/tahaluh

Include:

- A short description of the issue
- Affected extension version
- Operating system and VS Code version
- Steps to reproduce
- Impact assessment

Do not include real tokens, full `auth.json` files, or private prompt contents. Use redacted examples.

## Secret Handling

Codex Account Profiles is designed to rely on the official Codex CLI for login. The extension should never intentionally upload, print, or expose token material. Changes that touch `auth.json`, `CODEX_HOME`, process environment, or launcher cleanup logic should be reviewed with extra care.

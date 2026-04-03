# Security Policy

## Scope

Fast Browser is currently an alpha Chrome extension for structured browser automation.

The highest-risk areas are:

- prompt injection from page content
- unsafe browser actions
- provider credential handling
- permission scoping

## Supported branch

Security fixes are currently expected to land on `main`.

## Reporting a vulnerability

Please do not open a public exploit issue for credential exposure, privilege escalation, or a bypass of the action safety model.

Instead, report the issue privately to the maintainer first, with:

- a short description
- impact
- reproduction steps
- browser version
- whether the issue depends on a specific model provider

## Current safeguards

- small allowlisted action set
- sensitive field detection
- cross-origin navigation approval gates
- session-scoped API key storage
- extension-page CSP
- snapshot-local refs

## Known limitations

This project still has meaningful security limitations:

- prompt injection defenses are not complete
- iframe and shadow-DOM handling are incomplete
- host permissions are still broader in development than an ideal production deployment

Treat this as an alpha tool, not a hardened agent for high-risk browsing.

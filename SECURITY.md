# Security Policy

## Supported versions

Only the [latest release](https://github.com/princeneres/stream-vault/releases/latest) receives security fixes.

## Reporting a vulnerability

Please do not report security issues in public issues or pull requests.

Use GitHub's private reporting instead: open the repository's **Security** tab and choose
**Report a vulnerability**. Include the affected version, the steps to reproduce and the impact you observed.

You can expect an acknowledgement within a few days and a status update as the fix progresses.

## Scope

Stream Vault runs entirely on your machine. The areas most relevant to security are:

- the localhost media server (`src-tauri/src/media_server.rs`), which must only serve files inside a configured
  library root;
- Obsidian vault publishing (`src-tauri/src/vault.rs`), which must only write inside the configured vault folder;
- file paths and names coming from scanned folders, which are untrusted input.

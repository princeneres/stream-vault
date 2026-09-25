# Contributing to Stream Vault

Thanks for taking the time to contribute. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue with your distro, the app version (Settings or the release you installed), what you
  did, what you expected and what happened. Folder layouts that scan incorrectly are easiest to fix with a tree of
  the file names (`find <folder> -type f | head -50`); file names only, no media.
- **Features:** open an issue first for anything bigger than a small fix, so we can agree on the approach before
  you spend time on it.
- **Security issues:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Follow [Build from source](README.md#build-from-source), then:

```bash
pnpm install
pnpm tauri dev
```

## Guidelines

- **English everywhere in code:** identifiers, errors, logs and commit messages.
- **Keep the contract in sync.** `src-tauri/src/models.rs`, `src/lib/types.ts`, the schema in `db.rs` and the
  signatures in `commands.rs` describe the same shapes. Change Rust and TypeScript together, in the same commit.
- **Rescans must stay incremental.** Items are matched by `file_path`; never drop IDs or progress on a rescan.
- **Degrade gracefully.** Missing `ffmpeg`, `pdftoppm` or library folders must produce a clear message, not a
  crash.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:` …).

## Checks

Run these before opening a pull request:

```bash
pnpm lint
cd src-tauri && cargo clippy && cargo test
```

In the pull request, describe the change, why it is needed and how you tested it. Screenshots or a short clip
help for UI changes.

## License

The project has no license yet. Until one is added, contributions are accepted on the understanding that they
will be distributed under whichever open-source license the project adopts.

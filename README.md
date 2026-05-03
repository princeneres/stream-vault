# Stream Vault

Local-first desktop app for watching downloaded courses, TV series, and movies with progress tracking. Tauri shell, mpv as the player, SQLite for state.

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind 4 · Rust · SQLite (`rusqlite`) · external `mpv` + `ffmpeg` · pnpm · lucide-react

## Prerequisites

- **Node 20+** and **pnpm 10+**
- **Rust stable** (install via [rustup](https://rustup.rs))
- **mpv** and **ffmpeg** on the host (`mpv`, `ffmpeg`, `ffprobe` on `$PATH`)
- **Linux desktop deps** for Tauri 2 — Ubuntu/Debian:
  ```bash
  sudo apt install -y \
    libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    mpv ffmpeg
  ```

## Setup

```bash
pnpm install
pnpm tauri dev
```

The first launch creates `streamvault.db` under your platform's app data dir
(Linux: `~/.local/share/app.streamvault.dev/`).

## Layout

```
src/                  React frontend
  views/              Top-level screens (Home, LibraryView, DetailView, Settings)
  components/         UI primitives — design system
  lib/api.ts          Typed wrappers around Tauri invoke
  lib/types.ts        ⚠ Shared contract — mirrors src-tauri/src/models.rs
src-tauri/src/
  commands.rs         ⚠ Tauri command signatures — contract
  models.rs           ⚠ Domain types — contract
  db.rs               Schema + query layer
  scanner/            One module per library kind: courses, series, movies, generic
  mpv.rs              Spawn mpv + JSON IPC progress polling
  thumbnails.rs       ffmpeg-based thumbnail/poster generation
```

## Multi-agent build plan

Built using a coordinator + specialist pattern. Phase 0 (scaffold + contracts)
is done. Phase 1 dispatches four specialist agents in parallel against
disjoint file ownership boundaries, sharing the contract files.

| Agent | Owns |
| ----- | ---- |
| Backend Engineer    | `src-tauri/src/scanner/**`, query layer in `db.rs`, all commands except `play_item` |
| Player Engineer     | `src-tauri/src/mpv.rs`, `src-tauri/src/thumbnails.rs`, `play_item` |
| Design System Eng   | `src/components/**`, `src/styles/**`, Tailwind tokens |
| Frontend Engineer   | `src/views/**`, `src/lib/api.ts`, `src/App.tsx`, routing/hooks |

## Conventions

- Code in English. Identifiers, errors, logs, commit messages.
- Comments are rare. Only for non-obvious logic.
- Contract files (`models.rs`, `lib/types.ts`, schema in `db.rs`, signatures
  in `commands.rs`) are sacred — change them in lockstep.
- Errors crossing the Tauri boundary are `Result<T, String>`.

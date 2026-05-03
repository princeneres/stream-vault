# CLAUDE.md

Local-first desktop app for watching downloaded courses, TV series, and movies with progress tracking. Tauri shell, mpv as the player, SQLite for state.

## Stack

Tauri 2 · React 18 · TypeScript · Vite · Tailwind · Rust · SQLite (`tauri-plugin-sql`) · external `mpv` + `ffmpeg` · pnpm · lucide-react

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

## Commands

```bash
pnpm install              # install deps
pnpm tauri dev            # run app in dev mode
pnpm tauri build          # build production binary
cargo check               # in src-tauri/, fast type check
cargo clippy              # in src-tauri/, lints
cargo test                # in src-tauri/, run tests
pnpm lint                 # frontend lint
```

Runtime deps the app shells out to: `mpv`, `ffmpeg`, `ffprobe`. On Ubuntu: `sudo apt install mpv ffmpeg`.

## Domain model

A **Library** is a user-configured root folder with a `kind` (`courses` | `series` | `movies` | `generic`). It contains nested **Groups** (a course, a season, a module) and leaf **Items** (a video file). **Progress** is per-item. Movies skip groups (`group_id = NULL`); courses and series use one or two levels of groups via `parent_group_id`.

The same schema fits all kinds. The scanner is what differs — see `src-tauri/src/scanner/` for per-kind logic.

## Conventions

- **Code in English.** Identifiers, errors, logs, commit messages.
- **Comments are rare.** Only for non-obvious logic. Self-documenting names first.
- **Contract files are sacred.** `models.rs`, `lib/types.ts`, schema in `db.rs`, signatures in `commands.rs`. Changes here ripple through the app — do not edit casually. When the shape needs to change, update Rust and TS together in the same commit.
- **File ownership.** Frontend never edits `src-tauri/`. Backend never edits `src/`. The design system owns `components/` and `tailwind.config.js`; views consume but never modify primitives.
- **Errors crossing the Tauri boundary** are `Result<T, String>` (serializable).

## Playback flow

`play_item(id)` → load item + current progress → spawn `mpv` with `--input-ipc-server=<socket>` and `--start=<resume>` → background task polls `time-pos` every 3s via JSON IPC → writes to `progress` table → emits `item-progress` event for live UI updates → on exit, final save and mark `completed` if past 90% of duration.

Only one mpv instance at a time — a new `play_item` kills the previous session.

## Gotchas

- **Re-scans must be incremental.** Match by `file_path`; preserve existing IDs and progress.
- **Missing root folders** mark a library as `available: false` rather than crashing.
- **Title cleaning matters.** Strip leading `01 -`, release tags, extensions. For series, parse `SxxExx` patterns.
- **mpv/ffmpeg may be absent.** Detect `ErrorKind::NotFound`, surface a clear install hint, do not crash.
- **Linux first.** Windows/macOS support is structured-for but not implemented in MVP.

## When in doubt

Read the contract files (`models.rs`, `lib/types.ts`, `commands.rs`) first — they're the source of truth for shapes and surface area. Then read the relevant scanner or view. Avoid grepping the whole repo for behavior that's documented in those four files.
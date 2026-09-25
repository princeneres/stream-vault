# CLAUDE.md

Local-first desktop app for watching any folder of videos in sequence — courses, series, talks, tutorials, anything — with progress tracking. Tauri shell, built-in HTML5 player fed by a localhost media server, SQLite for state. Scanner *presets* (`courses`/`series`/`movies`/`generic`) tune how a folder is read; `generic` is the default. Each library has an optional unit label ("lesson", "episode", "part", …).

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind 4 · Rust · SQLite (`rusqlite`, bundled) · `tiny_http` media server · external `ffmpeg`/`ffprobe` (+ optional `pdftoppm`) · pnpm · lucide-react

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
  media_server.rs     Localhost HTTP server the <video> element streams from
  thumbnails.rs       ffmpeg thumbnails/posters, ffprobe durations
  vault.rs            Obsidian vault publishing for notes
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

Runtime deps the app shells out to: `ffmpeg`, `ffprobe`, and optionally `pdftoppm` for PDF previews. On Ubuntu: `sudo apt install ffmpeg poppler-utils`.

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

`PlayerOverlay` calls `get_item` (item + saved progress) → `media_url` returns `http://127.0.0.1:<port>/file?path=…` (byte-range, served only for files inside a library root) → `<video>` seeks to the resume position → `report_progress` every 3s and on pause/close → backend writes `progress`, marks `completed` at ≥ 90% of duration and emits `item-progress` for live UI updates.

`media_server.rs` serves a faststart view of MP4s with a trailing `moov` (header rebuilt in memory, `mdat` streamed from disk), because WebKitGTK won't seek back to read it over HTTP.

## Gotchas

- **Re-scans must be incremental.** Match by `file_path`; preserve existing IDs and progress.
- **Missing root folders** mark a library as `available: false` rather than crashing.
- **Title cleaning matters.** Strip leading `01 -`, release tags, extensions. For series, parse `SxxExx` patterns.
- **ffmpeg/pdftoppm may be absent.** Detect `ErrorKind::NotFound`, surface a clear install hint, do not crash.
- **Linux first.** Windows/macOS support is structured-for but not implemented in MVP.

## When in doubt

Read the contract files (`models.rs`, `lib/types.ts`, `commands.rs`) first — they're the source of truth for shapes and surface area. Then read the relevant scanner or view. Avoid grepping the whole repo for behavior that's documented in those four files.
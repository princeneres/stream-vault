<div align="center">

<img src="./src-tauri/icons/icon.png" alt="Stream Vault" width="128" height="128" />

# Stream Vault

**A local-first desktop app for your downloaded courses, TV series, and movies.**

Watch what you own, track what you watched — without the cloud.

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![SQLite](https://img.shields.io/badge/SQLite-bundled-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Platform](https://img.shields.io/badge/platform-Linux-success)](#installation)

</div>

---

## Why Stream Vault?

If you have a folder of courses, a series collection, or a movie library on disk and you're tired of bouncing between VLC, file managers, and spreadsheets to remember **what you watched and where you stopped** — Stream Vault is for you.

It's a thin, fast desktop shell over [`mpv`](https://mpv.io). No streaming server. No login. No telemetry. Your files stay where they are; the app just indexes, plays, and remembers.

## Features

- **Multiple library kinds** — `Courses`, `Series`, `Movies`, `Generic`. Each gets the right scanner and the right UI.
- **Resume where you stopped** — progress saved every 3s while playing; auto-marked completed past 90%.
- **Continue Watching** on Home — your in-progress items, ordered by recency.
- **Smart scanners** — handle nested folders, season patterns (`SxxExx`), release tags, leading numbers (`01 -`).
- **Auto-generated artwork** — thumbnails and posters via `ffmpeg` after each scan.
- **Custom posters** — pick any thumbnail as the group poster.
- **Incremental re-scans** — match files by path, preserve IDs and progress.
- **Built-in search** across libraries, groups, and items.
- **mpv playback** — full keyboard shortcuts, subtitles, audio tracks, hardware decoding. Whatever mpv supports, you get.
- **Local-first** — single SQLite database under your user data dir. No cloud, no account.

## Screenshots

> _Add screenshots of Home, Library, and Detail views here._

## Tech Stack

| Layer | Tech |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Frontend | React 19 · TypeScript · Vite · Tailwind 4 |
| Icons | [lucide-react](https://lucide.dev) |
| Backend | Rust |
| Database | SQLite via [`rusqlite`](https://github.com/rusqlite/rusqlite) |
| Player | external [`mpv`](https://mpv.io) over JSON IPC |
| Media tools | external [`ffmpeg`](https://ffmpeg.org) / `ffprobe` |

## Installation

### Linux (Debian / Ubuntu)

Download the latest `.deb` from [Releases](#) and install:

```bash
sudo dpkg -i stream-vault_*_amd64.deb
sudo apt-get install -f   # if any deps missing
```

Then launch **Stream Vault** from your application menu.

> **Runtime dependencies:** `mpv`, `ffmpeg`. Install with `sudo apt install mpv ffmpeg`.

Other platforms (Windows / macOS) are structured-for but not yet shipped — contributions welcome.

## Quick Start

1. Open Stream Vault.
2. **Settings → Add Library** and pick a folder.
3. Choose its kind: *Courses*, *Series*, *Movies*, or *Generic*.
4. Click **Scan** and let it index.
5. Pick anything and hit play — `mpv` opens, progress is tracked automatically.

The first launch creates `streamvault.db` under your platform's app data dir (Linux: `~/.local/share/app.streamvault.dev/`).

## Build from source

### Prerequisites

- **Node 20+** and **pnpm 10+**
- **Rust stable** (install via [rustup](https://rustup.rs))
- **mpv** and **ffmpeg** on `$PATH`
- **Linux desktop deps** for Tauri 2:

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  mpv ffmpeg
```

### Run in dev mode

```bash
pnpm install
pnpm tauri dev
```

### Build a production bundle

```bash
pnpm tauri build                  # all bundle targets
pnpm tauri build --bundles deb    # .deb only
```

The output lands under `src-tauri/target/release/bundle/`.

## Project structure

```
src/                  React frontend
  views/              Top-level screens (Home, LibraryView, DetailView, Settings)
  components/         UI primitives — design system
  lib/api.ts          Typed wrappers around Tauri invoke
  lib/types.ts        Shared contract — mirrors src-tauri/src/models.rs
src-tauri/src/
  commands.rs         Tauri command signatures
  models.rs           Domain types
  db.rs               Schema + query layer
  scanner/            One module per library kind: courses, series, movies, generic
  mpv.rs              Spawn mpv + JSON IPC progress polling
  thumbnails.rs       ffmpeg-based thumbnail/poster generation
```

The four contract files (`models.rs`, `lib/types.ts`, `db.rs`, `commands.rs`) are the source of truth — read them first.

## Domain model

A **Library** is a user-configured root folder with a `kind`. It contains nested **Groups** (a course, a season, a module) and leaf **Items** (a video file). **Progress** is per-item.

- Movies skip groups (`group_id = NULL`).
- Courses and series use one or two levels via `parent_group_id`.

The same schema fits all kinds — only the scanner differs.

## Playback flow

```
play_item(id)
  → load item + saved progress
  → spawn mpv with --input-ipc-server=<socket> --start=<resume>
  → poll time-pos every 3s via JSON IPC
  → write to progress table
  → emit item-progress event for live UI updates
  → on exit: final save, mark completed if >90% watched
```

Only one mpv instance at a time — a new `play_item` kills the previous session.

## Roadmap

- [ ] Windows and macOS builds
- [ ] Subtitle download integration
- [ ] Watch history view
- [ ] Library import/export
- [ ] External metadata providers (TMDB, TVDB) — opt-in
- [ ] Multi-user profiles

## Contributing

Pull requests are welcome. For non-trivial changes, please open an issue first to discuss the approach.

- Code in English (identifiers, errors, logs, commits).
- Keep contract files (`models.rs`, `lib/types.ts`, `db.rs`, `commands.rs`) in sync — Rust and TypeScript change in the same commit.
- Run `cargo clippy` and `pnpm lint` before pushing.

## License

To be defined.

---

<div align="center">

Built with [Tauri](https://tauri.app) and [mpv](https://mpv.io).

</div>

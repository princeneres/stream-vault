// CONTRACT: SQLite schema + `Database` handle.
//
// Schema lives here permanently. The Backend Engineer adds query methods
// (impl blocks below the schema migration) but MUST NOT change the schema
// without flagging the orchestrator.

use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open the SQLite database at `path` (creating it if missing) and run
    /// migrations. Safe to call on every app launch.
    pub fn new(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating db parent dir {parent:?}"))?;
        }
        let conn = Connection::open(path)
            .with_context(|| format!("opening sqlite at {path:?}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    /// Lock and access the underlying connection. Backend Engineer's query
    /// methods should go through this.
    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = self.conn.lock().expect("db mutex poisoned");
        f(&guard)
    }

    fn migrate(&self) -> Result<()> {
        let guard = self.conn.lock().expect("db mutex poisoned");
        guard.execute_batch(SCHEMA_V1)?;
        Ok(())
    }
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS libraries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    root_path       TEXT    NOT NULL UNIQUE,
    kind            TEXT    NOT NULL CHECK (kind IN ('courses','series','movies','generic')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS groups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id      INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    parent_group_id INTEGER          REFERENCES groups(id)    ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    folder_path     TEXT    NOT NULL UNIQUE,
    poster_path     TEXT
);
CREATE INDEX IF NOT EXISTS idx_groups_library_id      ON groups(library_id);
CREATE INDEX IF NOT EXISTS idx_groups_parent_group_id ON groups(parent_group_id);

CREATE TABLE IF NOT EXISTS items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id       INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    group_id         INTEGER          REFERENCES groups(id)    ON DELETE CASCADE,
    title            TEXT    NOT NULL,
    position         INTEGER NOT NULL DEFAULT 0,
    file_path        TEXT    NOT NULL UNIQUE,
    duration_seconds REAL,
    thumbnail_path   TEXT,
    season_number    INTEGER,
    episode_number   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_group_id   ON items(group_id);
CREATE INDEX IF NOT EXISTS idx_items_library_id ON items(library_id);

CREATE TABLE IF NOT EXISTS progress (
    item_id          INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    position_seconds REAL    NOT NULL DEFAULT 0,
    completed        INTEGER NOT NULL DEFAULT 0,
    watched_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_progress_watched_at ON progress(watched_at);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

// TODO(backend-eng): add query methods in an `impl Database` block below.
// CRUD for libraries/groups/items, get_continue_watching(limit),
// get_next_item(group_id), search(query), settings get/set, progress upsert.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_migrates_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().join("test.db")).unwrap();
        db.with_conn(|c| {
            let n: i64 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'",
                [],
                |r| r.get(0),
            )?;
            assert!(n >= 5, "expected 5+ tables, got {n}");
            Ok(())
        })
        .unwrap();
    }
}

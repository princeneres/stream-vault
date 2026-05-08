// CONTRACT: SQLite schema + `Database` handle.
//
// Schema lives here permanently. The Backend Engineer adds query methods
// (impl blocks below the schema migration) but MUST NOT change the schema
// without flagging the orchestrator.

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Cheaply cloneable handle to the SQLite connection. Clones share the
/// underlying connection through an `Arc<Mutex<_>>`, so it's safe to move
/// into background async tasks.
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
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
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
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
        let version: i32 =
            guard.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version < 1 {
            guard.execute_batch(MIGRATION_V1_NOTES)?;
            guard.pragma_update(None, "user_version", 1)?;
        }
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

/// Migration V1: stable `item_uuid` on every item (drives Obsidian publishing
/// independently of `id` / file_path) + `notes` table for timestamped notes.
/// Idempotent and gated by `PRAGMA user_version`.
const MIGRATION_V1_NOTES: &str = r#"
ALTER TABLE items ADD COLUMN item_uuid TEXT DEFAULT (lower(hex(randomblob(16))));
UPDATE items SET item_uuid = lower(hex(randomblob(16))) WHERE item_uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_uuid ON items(item_uuid);

CREATE TABLE IF NOT EXISTS notes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    timestamp_sec REAL    NOT NULL,
    content       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_item_id ON notes(item_id);
"#;

// ---- Query layer ----------------------------------------------------------

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension, Row};

use crate::models::{
    Group, Item, ItemWithProgress, Library, LibraryKind, Note, Progress, SearchResults,
};

fn parse_ts(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn library_from_row(r: &Row<'_>) -> rusqlite::Result<Library> {
    let kind_s: String = r.get("kind")?;
    let kind = LibraryKind::from_str(&kind_s).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(
            0,
            "kind".to_string(),
            rusqlite::types::Type::Text,
        )
    })?;
    let created_at_s: String = r.get("created_at")?;
    let last_scanned_at_s: Option<String> = r.get("last_scanned_at")?;
    Ok(Library {
        id: r.get("id")?,
        name: r.get("name")?,
        root_path: r.get("root_path")?,
        kind,
        created_at: parse_ts(&created_at_s),
        last_scanned_at: last_scanned_at_s.as_deref().map(parse_ts),
        available: false,
    })
}

fn group_from_row(r: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: r.get("id")?,
        library_id: r.get("library_id")?,
        parent_group_id: r.get("parent_group_id")?,
        title: r.get("title")?,
        position: r.get("position")?,
        folder_path: r.get("folder_path")?,
        poster_path: r.get("poster_path")?,
        item_count: r.get("item_count")?,
        completed_count: r.get("completed_count")?,
    })
}

/// SELECT clause that returns every `Group` field plus the recursive
/// `item_count` and `completed_count` aggregates over the group's subtree.
/// Use as the `<select>` in queries shaped like `<select> FROM groups g WHERE ...`.
///
/// `poster_path` falls back to the first descendant item's `thumbnail_path`
/// when the group has no explicit poster yet — keeps cards visually populated
/// before the artwork generator runs.
const GROUP_SELECT_WITH_AGGREGATES: &str = "
    WITH RECURSIVE descendants(root, id) AS (
        SELECT id, id FROM groups
        UNION ALL
        SELECT d.root, child.id
        FROM groups child JOIN descendants d ON child.parent_group_id = d.id
    ),
    aggregates AS (
        SELECT d.root AS group_id,
               COUNT(items.id) AS item_count,
               COALESCE(SUM(CASE WHEN progress.completed = 1 THEN 1 ELSE 0 END), 0) AS completed_count
        FROM descendants d
        LEFT JOIN items ON items.group_id = d.id
        LEFT JOIN progress ON progress.item_id = items.id
        GROUP BY d.root
    ),
    fallback_posters AS (
        SELECT group_id, thumbnail_path FROM (
            SELECT d.root AS group_id,
                   items.thumbnail_path,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.root
                       ORDER BY items.position, items.id
                   ) AS rn
            FROM descendants d
            JOIN items ON items.group_id = d.id
            WHERE items.thumbnail_path IS NOT NULL
        )
        WHERE rn = 1
    )
    SELECT g.id, g.library_id, g.parent_group_id, g.title, g.position,
           g.folder_path,
           COALESCE(g.poster_path, fp.thumbnail_path) AS poster_path,
           COALESCE(a.item_count, 0) AS item_count,
           COALESCE(a.completed_count, 0) AS completed_count
    FROM groups g
    LEFT JOIN aggregates a ON a.group_id = g.id
    LEFT JOIN fallback_posters fp ON fp.group_id = g.id";

fn item_from_row(r: &Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get("id")?,
        library_id: r.get("library_id")?,
        group_id: r.get("group_id")?,
        title: r.get("title")?,
        position: r.get("position")?,
        file_path: r.get("file_path")?,
        duration_seconds: r.get("duration_seconds")?,
        thumbnail_path: r.get("thumbnail_path")?,
        season_number: r.get("season_number")?,
        episode_number: r.get("episode_number")?,
    })
}

fn note_from_row(r: &Row<'_>) -> rusqlite::Result<Note> {
    let created_at_s: String = r.get("created_at")?;
    let updated_at_s: String = r.get("updated_at")?;
    Ok(Note {
        id: r.get("id")?,
        item_id: r.get("item_id")?,
        timestamp_sec: r.get("timestamp_sec")?,
        content: r.get("content")?,
        created_at: parse_ts(&created_at_s),
        updated_at: parse_ts(&updated_at_s),
    })
}

fn note_by_id_inner(c: &Connection, id: i64) -> Result<Note> {
    let mut stmt = c.prepare(
        "SELECT id, item_id, timestamp_sec, content, created_at, updated_at \
         FROM notes WHERE id = ?",
    )?;
    Ok(stmt.query_row([id], note_from_row)?)
}

fn progress_from_row(r: &Row<'_>) -> rusqlite::Result<Progress> {
    let ts: String = r.get("watched_at")?;
    let completed_int: i64 = r.get("completed")?;
    Ok(Progress {
        item_id: r.get("item_id")?,
        position_seconds: r.get("position_seconds")?,
        completed: completed_int != 0,
        watched_at: parse_ts(&ts),
    })
}

const ITEM_COLS: &str =
    "id, library_id, group_id, title, position, file_path, duration_seconds, thumbnail_path, season_number, episode_number";

fn qualified_item_cols(table_alias: &str) -> String {
    ITEM_COLS
        .split(", ")
        .map(|c| format!("{table_alias}.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertKind {
    Inserted,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone, Copy)]
pub struct UpsertResult {
    pub id: i64,
    pub kind: UpsertKind,
}

impl Database {
    // -- Libraries ---------------------------------------------------------

    pub fn insert_library(
        &self,
        name: &str,
        root_path: &str,
        kind: LibraryKind,
    ) -> Result<Library> {
        self.with_conn(|c| {
            c.execute(
                "INSERT INTO libraries (name, root_path, kind) VALUES (?, ?, ?)",
                params![name, root_path, kind.as_str()],
            )?;
            let id = c.last_insert_rowid();
            let mut stmt = c.prepare(
                "SELECT id, name, root_path, kind, created_at, last_scanned_at FROM libraries WHERE id = ?",
            )?;
            let lib = stmt.query_row([id], library_from_row)?;
            Ok(lib)
        })
    }

    pub fn delete_library_by_id(&self, id: i64) -> Result<()> {
        self.with_conn(|c| {
            c.execute("DELETE FROM libraries WHERE id = ?", [id])?;
            Ok(())
        })
    }

    pub fn list_libraries_raw(&self) -> Result<Vec<Library>> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT id, name, root_path, kind, created_at, last_scanned_at FROM libraries ORDER BY id",
            )?;
            let rows = stmt.query_map([], library_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn get_library_by_id(&self, id: i64) -> Result<Option<Library>> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT id, name, root_path, kind, created_at, last_scanned_at FROM libraries WHERE id = ?",
            )?;
            let lib = stmt.query_row([id], library_from_row).optional()?;
            Ok(lib)
        })
    }

    pub fn update_library_last_scanned(&self, id: i64, ts: DateTime<Utc>) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                "UPDATE libraries SET last_scanned_at = ? WHERE id = ?",
                params![ts.to_rfc3339(), id],
            )?;
            Ok(())
        })
    }

    // -- Groups ------------------------------------------------------------

    pub fn list_groups_by_library(&self, library_id: i64) -> Result<Vec<Group>> {
        self.with_conn(|c| {
            let sql = format!(
                "{GROUP_SELECT_WITH_AGGREGATES}
                 WHERE g.library_id = ? ORDER BY g.position, g.title"
            );
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map([library_id], group_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn list_top_level_groups(&self, library_id: i64) -> Result<Vec<Group>> {
        self.with_conn(|c| {
            let sql = format!(
                "{GROUP_SELECT_WITH_AGGREGATES}
                 WHERE g.library_id = ? AND g.parent_group_id IS NULL
                 ORDER BY g.position, g.title"
            );
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map([library_id], group_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn list_subgroups(&self, parent_group_id: i64) -> Result<Vec<Group>> {
        self.with_conn(|c| {
            let sql = format!(
                "{GROUP_SELECT_WITH_AGGREGATES}
                 WHERE g.parent_group_id = ? ORDER BY g.position, g.title"
            );
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map([parent_group_id], group_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn get_group_by_id(&self, id: i64) -> Result<Option<Group>> {
        self.with_conn(|c| {
            let sql = format!("{GROUP_SELECT_WITH_AGGREGATES} WHERE g.id = ?");
            let mut stmt = c.prepare(&sql)?;
            let g = stmt.query_row([id], group_from_row).optional()?;
            Ok(g)
        })
    }

    pub fn upsert_group_by_folder_path(
        &self,
        library_id: i64,
        parent_group_id: Option<i64>,
        title: &str,
        position: i32,
        folder_path: &str,
        poster_path: Option<&str>,
    ) -> Result<UpsertResult> {
        self.with_conn(|c| {
            let existing: Option<(i64, Option<i64>, String, i32, Option<String>)> = c
                .query_row(
                    "SELECT id, parent_group_id, title, position, poster_path FROM groups WHERE folder_path = ?",
                    [folder_path],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()?;
            if let Some((id, p_g, p_t, p_pos, p_poster)) = existing {
                let same = p_g == parent_group_id
                    && p_t == title
                    && p_pos == position
                    && p_poster.as_deref() == poster_path;
                if same {
                    return Ok(UpsertResult { id, kind: UpsertKind::Unchanged });
                }
                c.execute(
                    "UPDATE groups SET library_id = ?, parent_group_id = ?, title = ?, position = ?, poster_path = ? WHERE id = ?",
                    params![library_id, parent_group_id, title, position, poster_path, id],
                )?;
                Ok(UpsertResult { id, kind: UpsertKind::Updated })
            } else {
                c.execute(
                    "INSERT INTO groups (library_id, parent_group_id, title, position, folder_path, poster_path) VALUES (?, ?, ?, ?, ?, ?)",
                    params![library_id, parent_group_id, title, position, folder_path, poster_path],
                )?;
                Ok(UpsertResult { id: c.last_insert_rowid(), kind: UpsertKind::Inserted })
            }
        })
    }

    pub fn delete_group_by_id(&self, id: i64) -> Result<()> {
        self.with_conn(|c| {
            c.execute("DELETE FROM groups WHERE id = ?", [id])?;
            Ok(())
        })
    }

    pub fn update_group_poster(&self, id: i64, poster_path: Option<&str>) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                "UPDATE groups SET poster_path = ? WHERE id = ?",
                params![poster_path, id],
            )?;
            Ok(())
        })
    }

    // -- Items -------------------------------------------------------------

    pub fn list_items_by_library(&self, library_id: i64) -> Result<Vec<Item>> {
        self.with_conn(|c| {
            let q = format!(
                "SELECT {ITEM_COLS} FROM items WHERE library_id = ? ORDER BY position, title"
            );
            let mut stmt = c.prepare(&q)?;
            let rows = stmt.query_map([library_id], item_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn list_items_by_group(&self, group_id: i64) -> Result<Vec<Item>> {
        self.with_conn(|c| {
            let q = format!(
                "SELECT {ITEM_COLS} FROM items WHERE group_id = ? ORDER BY position, title"
            );
            let mut stmt = c.prepare(&q)?;
            let rows = stmt.query_map([group_id], item_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn list_top_items_by_library(&self, library_id: i64) -> Result<Vec<Item>> {
        self.with_conn(|c| {
            let q = format!(
                "SELECT {ITEM_COLS} FROM items WHERE library_id = ? AND group_id IS NULL ORDER BY position, title"
            );
            let mut stmt = c.prepare(&q)?;
            let rows = stmt.query_map([library_id], item_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn get_item_by_id(&self, id: i64) -> Result<Option<Item>> {
        self.with_conn(|c| {
            let q = format!("SELECT {ITEM_COLS} FROM items WHERE id = ?");
            let mut stmt = c.prepare(&q)?;
            let it = stmt.query_row([id], item_from_row).optional()?;
            Ok(it)
        })
    }

    pub fn upsert_item_by_file_path(
        &self,
        library_id: i64,
        group_id: Option<i64>,
        title: &str,
        position: i32,
        file_path: &str,
        duration_seconds: Option<f64>,
        thumbnail_path: Option<&str>,
        season_number: Option<i32>,
        episode_number: Option<i32>,
    ) -> Result<UpsertResult> {
        self.with_conn(|c| {
            let existing: Option<(
                i64,
                Option<i64>,
                String,
                i32,
                Option<f64>,
                Option<String>,
                Option<i32>,
                Option<i32>,
            )> = c
                .query_row(
                    "SELECT id, group_id, title, position, duration_seconds, thumbnail_path, season_number, episode_number FROM items WHERE file_path = ?",
                    [file_path],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
                )
                .optional()?;
            if let Some((id, p_g, p_t, p_pos, p_dur, p_thumb, p_s, p_e)) = existing {
                let same = p_g == group_id
                    && p_t == title
                    && p_pos == position
                    && p_dur == duration_seconds
                    && p_thumb.as_deref() == thumbnail_path
                    && p_s == season_number
                    && p_e == episode_number;
                if same {
                    return Ok(UpsertResult { id, kind: UpsertKind::Unchanged });
                }
                c.execute(
                    "UPDATE items SET library_id = ?, group_id = ?, title = ?, position = ?, duration_seconds = ?, thumbnail_path = ?, season_number = ?, episode_number = ? WHERE id = ?",
                    params![library_id, group_id, title, position, duration_seconds, thumbnail_path, season_number, episode_number, id],
                )?;
                Ok(UpsertResult { id, kind: UpsertKind::Updated })
            } else {
                c.execute(
                    "INSERT INTO items (library_id, group_id, title, position, file_path, duration_seconds, thumbnail_path, season_number, episode_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![library_id, group_id, title, position, file_path, duration_seconds, thumbnail_path, season_number, episode_number],
                )?;
                Ok(UpsertResult { id: c.last_insert_rowid(), kind: UpsertKind::Inserted })
            }
        })
    }

    pub fn delete_item_by_id(&self, id: i64) -> Result<()> {
        self.with_conn(|c| {
            c.execute("DELETE FROM items WHERE id = ?", [id])?;
            Ok(())
        })
    }

    pub fn update_item_thumbnail(&self, id: i64, thumb: Option<&str>) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                "UPDATE items SET thumbnail_path = ? WHERE id = ?",
                params![thumb, id],
            )?;
            Ok(())
        })
    }

    pub fn update_item_duration(&self, id: i64, duration_seconds: Option<f64>) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                "UPDATE items SET duration_seconds = ? WHERE id = ?",
                params![duration_seconds, id],
            )?;
            Ok(())
        })
    }

    // -- Progress ----------------------------------------------------------

    pub fn get_progress_by_item(&self, item_id: i64) -> Result<Option<Progress>> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT item_id, position_seconds, completed, watched_at FROM progress WHERE item_id = ?",
            )?;
            let p = stmt.query_row([item_id], progress_from_row).optional()?;
            Ok(p)
        })
    }

    pub fn upsert_progress(
        &self,
        item_id: i64,
        position_seconds: f64,
        completed: bool,
    ) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                r#"INSERT INTO progress (item_id, position_seconds, completed, watched_at)
                   VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                   ON CONFLICT(item_id) DO UPDATE SET
                       position_seconds = excluded.position_seconds,
                       completed        = excluded.completed,
                       watched_at       = excluded.watched_at"#,
                params![item_id, position_seconds, completed as i64],
            )?;
            Ok(())
        })
    }

    pub fn delete_progress(&self, item_id: i64) -> Result<()> {
        self.with_conn(|c| {
            c.execute("DELETE FROM progress WHERE item_id = ?", [item_id])?;
            Ok(())
        })
    }

    /// All leaf item ids in `group_id`'s subtree, paired with their stored
    /// duration (if any). Used to cascade a "mark watched" toggle from a
    /// group to every item it contains.
    pub fn list_item_ids_in_group_subtree(
        &self,
        group_id: i64,
    ) -> Result<Vec<(i64, Option<f64>)>> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                r#"
                WITH RECURSIVE tree(id) AS (
                    SELECT id FROM groups WHERE id = ?
                    UNION ALL
                    SELECT g.id FROM groups g JOIN tree t ON g.parent_group_id = t.id
                )
                SELECT i.id, i.duration_seconds
                FROM items i JOIN tree t ON t.id = i.group_id
                "#,
            )?;
            let rows = stmt.query_map([group_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, Option<f64>>(1)?))
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    /// Returns items keyed by id with their `Progress` (if any).
    pub fn map_progress_for_items(
        &self,
        item_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, Progress>> {
        if item_ids.is_empty() {
            return Ok(Default::default());
        }
        self.with_conn(|c| {
            let placeholders = std::iter::repeat("?")
                .take(item_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let q = format!(
                "SELECT item_id, position_seconds, completed, watched_at FROM progress WHERE item_id IN ({placeholders})"
            );
            let mut stmt = c.prepare(&q)?;
            let params_iter: Vec<&dyn rusqlite::ToSql> =
                item_ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(params_iter.as_slice(), progress_from_row)?;
            let mut out = std::collections::HashMap::new();
            for r in rows {
                let p = r?;
                out.insert(p.item_id, p);
            }
            Ok(out)
        })
    }

    // -- Continue Watching / Next Item / Search ----------------------------

    pub fn get_continue_watching(&self, limit: u32) -> Result<Vec<ItemWithProgress>> {
        self.with_conn(|c| {
            let qual_cols = qualified_item_cols("i");
            let q = format!(
                r#"SELECT {qual_cols}, p.position_seconds AS p_pos, p.completed AS p_done, p.watched_at AS p_at
                   FROM items i JOIN progress p ON p.item_id = i.id
                   WHERE p.position_seconds > 0 AND p.completed = 0
                   ORDER BY p.watched_at DESC
                   LIMIT ?"#,
            );
            let mut stmt = c.prepare(&q)?;
            let rows = stmt.query_map([limit as i64], |r| {
                let item = item_from_row(r)?;
                let p_pos: f64 = r.get("p_pos")?;
                let p_done: i64 = r.get("p_done")?;
                let p_at_s: String = r.get("p_at")?;
                let progress = Progress {
                    item_id: item.id,
                    position_seconds: p_pos,
                    completed: p_done != 0,
                    watched_at: parse_ts(&p_at_s),
                };
                Ok(ItemWithProgress {
                    item,
                    progress: Some(progress),
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn get_next_item(&self, group_id: i64) -> Result<Option<Item>> {
        self.with_conn(|c| {
            // Recursive CTE walks the group's tree; pick the first item in
            // `(group.position, item.position)` order whose progress is null
            // or completed = 0. Fallback: first item if all completed.
            let qual_cols = qualified_item_cols("i");
            let q = format!(
                r#"
                WITH RECURSIVE
                  tree(id, position, depth) AS (
                      SELECT id, position, 0 FROM groups WHERE id = ?
                      UNION ALL
                      SELECT g.id, g.position, t.depth + 1
                        FROM groups g JOIN tree t ON g.parent_group_id = t.id
                  )
                SELECT {qual_cols}, COALESCE(p.completed, 0) AS done
                FROM items i
                JOIN tree t ON t.id = i.group_id
                LEFT JOIN progress p ON p.item_id = i.id
                ORDER BY t.depth, t.position, i.position, i.title
                "#,
            );
            let mut stmt = c.prepare(&q)?;
            let mut rows = stmt.query([group_id])?;
            let mut first_item: Option<Item> = None;
            while let Some(row) = rows.next()? {
                let it = item_from_row(row)?;
                let done: i64 = row.get("done")?;
                if first_item.is_none() {
                    first_item = Some(it.clone());
                }
                if done == 0 {
                    return Ok(Some(it));
                }
            }
            Ok(first_item)
        })
    }

    pub fn search(&self, query: &str, per_kind: u32) -> Result<SearchResults> {
        self.with_conn(|c| {
            let pattern = format!("%{query}%");
            let g_sql = format!(
                "{GROUP_SELECT_WITH_AGGREGATES}
                 WHERE g.title LIKE ? COLLATE NOCASE ORDER BY g.title LIMIT ?"
            );
            let mut g_stmt = c.prepare(&g_sql)?;
            let groups: Vec<Group> = g_stmt
                .query_map(params![pattern, per_kind as i64], group_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let q_items = format!(
                "SELECT {ITEM_COLS} FROM items WHERE title LIKE ? COLLATE NOCASE ORDER BY title LIMIT ?",
            );
            let mut i_stmt = c.prepare(&q_items)?;
            let items: Vec<Item> = i_stmt
                .query_map(params![pattern, per_kind as i64], item_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let ids: Vec<i64> = items.iter().map(|i| i.id).collect();
            drop(g_stmt);
            drop(i_stmt);
            let progress_map = if ids.is_empty() {
                std::collections::HashMap::new()
            } else {
                let placeholders =
                    std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
                let q = format!(
                    "SELECT item_id, position_seconds, completed, watched_at FROM progress WHERE item_id IN ({placeholders})"
                );
                let mut stmt = c.prepare(&q)?;
                let params_iter: Vec<&dyn rusqlite::ToSql> =
                    ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
                let rows = stmt.query_map(params_iter.as_slice(), progress_from_row)?;
                let mut m = std::collections::HashMap::new();
                for r in rows {
                    let p = r?;
                    m.insert(p.item_id, p);
                }
                m
            };
            let items_with_progress = items
                .into_iter()
                .map(|item| ItemWithProgress {
                    progress: progress_map.get(&item.id).cloned(),
                    item,
                })
                .collect();

            Ok(SearchResults {
                groups,
                items: items_with_progress,
            })
        })
    }

    pub fn get_item_uuid(&self, id: i64) -> Result<Option<String>> {
        self.with_conn(|c| {
            let v: Option<Option<String>> = c
                .query_row(
                    "SELECT item_uuid FROM items WHERE id = ?",
                    [id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()?;
            Ok(v.flatten())
        })
    }

    // -- Notes -------------------------------------------------------------

    pub fn insert_note(
        &self,
        item_id: i64,
        timestamp_sec: f64,
        content: &str,
    ) -> Result<Note> {
        self.with_conn(|c| {
            c.execute(
                "INSERT INTO notes (item_id, timestamp_sec, content) VALUES (?, ?, ?)",
                params![item_id, timestamp_sec, content],
            )?;
            let id = c.last_insert_rowid();
            note_by_id_inner(c, id)
        })
    }

    pub fn update_note(&self, id: i64, content: &str) -> Result<Note> {
        self.with_conn(|c| {
            let updated = c.execute(
                "UPDATE notes SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
                params![content, id],
            )?;
            if updated == 0 {
                return Err(anyhow::anyhow!("note {id} not found"));
            }
            note_by_id_inner(c, id)
        })
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        self.with_conn(|c| {
            c.execute("DELETE FROM notes WHERE id = ?", [id])?;
            Ok(())
        })
    }

    pub fn list_notes_for_item(&self, item_id: i64) -> Result<Vec<Note>> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT id, item_id, timestamp_sec, content, created_at, updated_at \
                 FROM notes WHERE item_id = ? ORDER BY timestamp_sec, id",
            )?;
            let rows = stmt.query_map([item_id], note_from_row)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    pub fn count_notes_for_items(
        &self,
        item_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, i64>> {
        if item_ids.is_empty() {
            return Ok(Default::default());
        }
        self.with_conn(|c| {
            let placeholders = std::iter::repeat("?")
                .take(item_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let q = format!(
                "SELECT item_id, COUNT(*) FROM notes WHERE item_id IN ({placeholders}) GROUP BY item_id"
            );
            let mut stmt = c.prepare(&q)?;
            let params_iter: Vec<&dyn rusqlite::ToSql> =
                item_ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(params_iter.as_slice(), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })?;
            let mut out = std::collections::HashMap::new();
            for r in rows {
                let (id, n) = r?;
                out.insert(id, n);
            }
            Ok(out)
        })
    }

    // -- Settings ----------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.with_conn(|c| {
            let v: Option<String> = c
                .query_row(
                    "SELECT value FROM settings WHERE key = ?",
                    [key],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(v)
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.with_conn(|c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }
}

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

    fn fresh() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    #[test]
    fn continue_watching_orders_by_watched_at_desc() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L", LibraryKind::Movies).unwrap();
        let a = db
            .upsert_item_by_file_path(lib.id, None, "A", 1, "/tmp/L/a.mp4", None, None, None, None)
            .unwrap();
        let b = db
            .upsert_item_by_file_path(lib.id, None, "B", 2, "/tmp/L/b.mp4", None, None, None, None)
            .unwrap();
        // older first, then newer — newer should appear first
        db.upsert_progress(a.id, 10.0, false).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        db.upsert_progress(b.id, 20.0, false).unwrap();
        let cw = db.get_continue_watching(10).unwrap();
        assert_eq!(cw.len(), 2);
        assert_eq!(cw[0].item.id, b.id);
        assert_eq!(cw[1].item.id, a.id);
    }

    #[test]
    fn continue_watching_excludes_completed_and_zero() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L2", LibraryKind::Movies).unwrap();
        let a = db
            .upsert_item_by_file_path(lib.id, None, "A", 1, "/tmp/L2/a.mp4", None, None, None, None)
            .unwrap();
        let b = db
            .upsert_item_by_file_path(lib.id, None, "B", 2, "/tmp/L2/b.mp4", None, None, None, None)
            .unwrap();
        let c = db
            .upsert_item_by_file_path(lib.id, None, "C", 3, "/tmp/L2/c.mp4", None, None, None, None)
            .unwrap();
        db.upsert_progress(a.id, 0.0, false).unwrap(); // pos 0 → exclude
        db.upsert_progress(b.id, 100.0, true).unwrap(); // completed → exclude
        db.upsert_progress(c.id, 100.0, false).unwrap(); // include
        let cw = db.get_continue_watching(10).unwrap();
        assert_eq!(cw.len(), 1);
        assert_eq!(cw[0].item.id, c.id);
    }

    #[test]
    fn next_item_returns_first_incomplete() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L3", LibraryKind::Series).unwrap();
        let g = db
            .upsert_group_by_folder_path(lib.id, None, "S", 1, "/tmp/L3/S", None)
            .unwrap();
        let i1 = db
            .upsert_item_by_file_path(lib.id, Some(g.id), "E1", 1, "/tmp/L3/S/e1.mp4", None, None, None, None)
            .unwrap();
        let i2 = db
            .upsert_item_by_file_path(lib.id, Some(g.id), "E2", 2, "/tmp/L3/S/e2.mp4", None, None, None, None)
            .unwrap();
        db.upsert_progress(i1.id, 100.0, true).unwrap();
        let next = db.get_next_item(g.id).unwrap();
        assert_eq!(next.map(|i| i.id), Some(i2.id));
    }

    #[test]
    fn next_item_falls_back_when_all_completed() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L4", LibraryKind::Series).unwrap();
        let g = db
            .upsert_group_by_folder_path(lib.id, None, "S", 1, "/tmp/L4/S", None)
            .unwrap();
        let i1 = db
            .upsert_item_by_file_path(lib.id, Some(g.id), "E1", 1, "/tmp/L4/S/e1.mp4", None, None, None, None)
            .unwrap();
        let i2 = db
            .upsert_item_by_file_path(lib.id, Some(g.id), "E2", 2, "/tmp/L4/S/e2.mp4", None, None, None, None)
            .unwrap();
        db.upsert_progress(i1.id, 100.0, true).unwrap();
        db.upsert_progress(i2.id, 100.0, true).unwrap();
        let next = db.get_next_item(g.id).unwrap();
        assert_eq!(next.map(|i| i.id), Some(i1.id));
    }

    #[test]
    fn next_item_walks_subgroups() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L5", LibraryKind::Courses).unwrap();
        let parent = db
            .upsert_group_by_folder_path(lib.id, None, "Course", 1, "/tmp/L5/c", None)
            .unwrap();
        let m1 = db
            .upsert_group_by_folder_path(lib.id, Some(parent.id), "M1", 1, "/tmp/L5/c/m1", None)
            .unwrap();
        let m2 = db
            .upsert_group_by_folder_path(lib.id, Some(parent.id), "M2", 2, "/tmp/L5/c/m2", None)
            .unwrap();
        let _v1 = db
            .upsert_item_by_file_path(lib.id, Some(m1.id), "V1", 1, "/tmp/L5/c/m1/v1.mp4", None, None, None, None)
            .unwrap();
        let v2 = db
            .upsert_item_by_file_path(lib.id, Some(m2.id), "V2", 1, "/tmp/L5/c/m2/v2.mp4", None, None, None, None)
            .unwrap();
        db.upsert_progress(_v1.id, 100.0, true).unwrap();
        let next = db.get_next_item(parent.id).unwrap();
        assert_eq!(next.map(|i| i.id), Some(v2.id));
    }

    #[test]
    fn search_finds_groups_and_items_case_insensitive() {
        let (_d, db) = fresh();
        let lib = db.insert_library("L", "/tmp/L6", LibraryKind::Generic).unwrap();
        let _g = db
            .upsert_group_by_folder_path(lib.id, None, "Rust Course", 1, "/tmp/L6/rust", None)
            .unwrap();
        let _i = db
            .upsert_item_by_file_path(lib.id, None, "Rust Lesson", 1, "/tmp/L6/x.mp4", None, None, None, None)
            .unwrap();
        let r = db.search("RUST", 20).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.items.len(), 1);
    }

    #[test]
    fn group_aggregates_count_descendant_items_and_completed() {
        let (_d, db) = fresh();
        let lib = db
            .insert_library("L", "/tmp/L7", LibraryKind::Courses)
            .unwrap();
        let parent = db
            .upsert_group_by_folder_path(lib.id, None, "Course", 1, "/tmp/L7/c", None)
            .unwrap();
        let m1 = db
            .upsert_group_by_folder_path(lib.id, Some(parent.id), "M1", 1, "/tmp/L7/c/m1", None)
            .unwrap();
        let m2 = db
            .upsert_group_by_folder_path(lib.id, Some(parent.id), "M2", 2, "/tmp/L7/c/m2", None)
            .unwrap();
        let v1 = db
            .upsert_item_by_file_path(lib.id, Some(m1.id), "V1", 1, "/tmp/L7/c/m1/v1.mp4", None, None, None, None)
            .unwrap();
        let _v2 = db
            .upsert_item_by_file_path(lib.id, Some(m1.id), "V2", 2, "/tmp/L7/c/m1/v2.mp4", None, None, None, None)
            .unwrap();
        let v3 = db
            .upsert_item_by_file_path(lib.id, Some(m2.id), "V3", 1, "/tmp/L7/c/m2/v3.mp4", None, None, None, None)
            .unwrap();

        db.upsert_progress(v1.id, 100.0, true).unwrap();
        db.upsert_progress(v3.id, 50.0, false).unwrap();

        let top = db.list_top_level_groups(lib.id).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].id, parent.id);
        assert_eq!(top[0].item_count, 3);
        assert_eq!(top[0].completed_count, 1);

        let subs = db.list_subgroups(parent.id).unwrap();
        let m1_row = subs.iter().find(|g| g.id == m1.id).unwrap();
        let m2_row = subs.iter().find(|g| g.id == m2.id).unwrap();
        assert_eq!(m1_row.item_count, 2);
        assert_eq!(m1_row.completed_count, 1);
        assert_eq!(m2_row.item_count, 1);
        assert_eq!(m2_row.completed_count, 0);

        let one = db.get_group_by_id(parent.id).unwrap().unwrap();
        assert_eq!(one.item_count, 3);
        assert_eq!(one.completed_count, 1);
    }

    #[test]
    fn settings_roundtrip() {
        let (_d, db) = fresh();
        assert!(db.get_setting("missing").unwrap().is_none());
        db.set_setting("k", "v1").unwrap();
        assert_eq!(db.get_setting("k").unwrap().as_deref(), Some("v1"));
        db.set_setting("k", "v2").unwrap();
        assert_eq!(db.get_setting("k").unwrap().as_deref(), Some("v2"));
    }
}

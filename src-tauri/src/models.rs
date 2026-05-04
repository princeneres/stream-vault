// CONTRACT: domain types shared with the frontend.
//
// Mirror of `src/lib/types.ts`. Wire format is camelCase via
// `#[serde(rename_all = "camelCase")]`. SQL stores snake_case.
// `LibraryKind` serializes to lowercase strings to match the
// `kind` CHECK constraint in `db.rs`.
//
// Owner: Orchestrator. Specialists must NOT change shapes here without
// flagging — `lib/types.ts` and `db.rs` schema must stay in sync.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryKind {
    Courses,
    Series,
    Movies,
    Generic,
}

impl LibraryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LibraryKind::Courses => "courses",
            LibraryKind::Series => "series",
            LibraryKind::Movies => "movies",
            LibraryKind::Generic => "generic",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "courses" => Some(Self::Courses),
            "series" => Some(Self::Series),
            "movies" => Some(Self::Movies),
            "generic" => Some(Self::Generic),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub kind: LibraryKind,
    pub created_at: DateTime<Utc>,
    pub last_scanned_at: Option<DateTime<Utc>>,
    /// Transient — true if `root_path` exists at query time.
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: i64,
    pub library_id: i64,
    pub parent_group_id: Option<i64>,
    pub title: String,
    pub position: i32,
    pub folder_path: String,
    pub poster_path: Option<String>,
    /// Total leaf items in this group's subtree (self + all descendants).
    pub item_count: i32,
    /// Items in this group's subtree whose progress is `completed = 1`.
    pub completed_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub library_id: i64,
    pub group_id: Option<i64>,
    pub title: String,
    pub position: i32,
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_path: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub item_id: i64,
    pub position_seconds: f64,
    pub completed: bool,
    pub watched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemWithProgress {
    #[serde(flatten)]
    pub item: Item,
    pub progress: Option<Progress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdate {
    pub item_id: i64,
    pub position_seconds: f64,
    pub duration_seconds: f64,
}

// --- Aggregates returned by commands ---

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub items_added: u32,
    pub items_removed: u32,
    pub items_updated: u32,
    pub groups_added: u32,
    pub groups_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContents {
    pub library: Library,
    pub groups: Vec<Group>,
    /// For `movies` libraries (group_id IS NULL items). Empty for other kinds.
    pub top_items: Vec<ItemWithProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetail {
    pub group: Group,
    pub subgroups: Vec<Group>,
    pub items: Vec<ItemWithProgress>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub groups: Vec<Group>,
    pub items: Vec<ItemWithProgress>,
}

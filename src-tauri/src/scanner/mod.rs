// Scanner: walks a library root and reconciles DB rows.
//
// Per-kind dispatch lives in sub-modules. Common helpers (video extension
// detection, title cleaning, position parsing, natural sort) are here.
//
// Re-scans are incremental: items are keyed by absolute `file_path`, so an
// existing row keeps its id (and therefore its `progress`). Rows for files
// that no longer exist on disk are deleted (cascade removes their progress).
// Malformed entries are skipped with a warning rather than aborting the scan.

pub mod courses;
pub mod generic;
pub mod movies;
pub mod series;

use std::cmp::Ordering;
use std::path::Path;

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;

use crate::db::Database;
use crate::models::{Group, Library, LibraryKind, ScanResult};

/// Scan a library root and reconcile DB rows. Dispatches by `library.kind`.
pub fn scan(library: &Library, db: &Database) -> Result<ScanResult> {
    match library.kind {
        LibraryKind::Courses => courses::scan(library, db),
        LibraryKind::Series => series::scan(library, db),
        LibraryKind::Movies => movies::scan(library, db),
        LibraryKind::Generic => generic::scan(library, db),
    }
}

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "avi", "mov", "m4v"];

pub(crate) fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_ascii_lowercase();
            VIDEO_EXTENSIONS.iter().any(|v| *v == lower)
        })
        .unwrap_or(false)
}

static LEADING_NUMERIC: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(\d{1,4})\s*[-_.):\s]+").unwrap());

static RELEASE_TAG_BRACKET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*[\[\(][^\]\)]*[\]\)]").unwrap());

static RELEASE_TAG_DOTTED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)[\.\s_-]+(1080p|2160p|720p|480p|web[-_.]?dl|webrip|web|bluray|blu-ray|brrip|bdrip|dvdrip|hdtv|hdrip|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|atmos|10bit|hdr|repack|proper|internal|extended|remastered|imax|uncut)\b[\w\d]*").unwrap()
});

static SXXEXX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bs(\d{1,3})\s*e(\d{1,3})\b").unwrap());

static NUM_X_NUM: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d{1,3})x(\d{1,3})\b").unwrap());

static SEASON_FOLDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(?:season|temporada|saison|staffel)\s*(\d{1,3})\b").unwrap());

static SHORT_SEASON_FOLDER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^s(\d{1,3})\b").unwrap());

/// Strip a leading numeric ordinal from a string. Returns `(position, rest)`
/// where `position` is `i32::MAX` if no prefix was found.
pub(crate) fn parse_position(name: &str) -> (i32, String) {
    if let Some(cap) = LEADING_NUMERIC.captures(name) {
        if let Ok(n) = cap[1].parse::<i32>() {
            let rest = LEADING_NUMERIC.replace(name, "").to_string();
            return (n, rest);
        }
    }
    (i32::MAX, name.to_string())
}

/// Clean a filename / folder name into a title:
///   - drop file extension
///   - drop leading numeric prefix (`01 - `, `01. `, `01) `, `01_`)
///   - drop common release tags (`[1080p]`, `(2023)`, `.WEB-DL`, `.x264`, ...)
///   - replace separators (`_`, `.`) with spaces
///   - collapse whitespace and trim
pub(crate) fn clean_title(raw: &str) -> String {
    let mut t = strip_extension(raw);
    let (_pos, rest) = parse_position(&t);
    t = rest;
    t = RELEASE_TAG_BRACKET.replace_all(&t, "").to_string();
    t = RELEASE_TAG_DOTTED.replace_all(&t, "").to_string();
    t = t.replace(['_', '.'], " ");
    while t.contains("  ") {
        t = t.replace("  ", " ");
    }
    t.trim().to_string()
}

/// `(season, episode, cleaned_title)` — None for `(s, e)` if no marker found.
pub(crate) fn parse_season_episode(raw: &str) -> (Option<i32>, Option<i32>, String) {
    let stripped = strip_extension(raw);
    if let Some(cap) = SXXEXX.captures(&stripped) {
        let s: i32 = cap[1].parse().unwrap_or(0);
        let e: i32 = cap[2].parse().unwrap_or(0);
        let cleaned = SXXEXX.replace(&stripped, " ").to_string();
        return (Some(s), Some(e), clean_title(&cleaned));
    }
    if let Some(cap) = NUM_X_NUM.captures(&stripped) {
        let s: i32 = cap[1].parse().unwrap_or(0);
        let e: i32 = cap[2].parse().unwrap_or(0);
        let cleaned = NUM_X_NUM.replace(&stripped, " ").to_string();
        return (Some(s), Some(e), clean_title(&cleaned));
    }
    (None, None, clean_title(&stripped))
}

fn strip_extension(s: &str) -> String {
    if let Some(dot) = s.rfind('.') {
        let ext = &s[dot + 1..];
        if (1..=4).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return s[..dot].to_string();
        }
    }
    s.to_string()
}

/// Parse `Season 03` / `S03` / `Temporada 3` from a folder name. None if no
/// match.
pub(crate) fn parse_season_folder(name: &str) -> Option<i32> {
    if let Some(cap) = SEASON_FOLDER.captures(name) {
        return cap[1].parse().ok();
    }
    if let Some(cap) = SHORT_SEASON_FOLDER.captures(name) {
        return cap[1].parse().ok();
    }
    None
}

/// Compare two strings naturally (digit runs compared as numbers).
pub(crate) fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(ac), Some(bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let (na, ra) = take_number(&mut ai);
                    let (nb, rb) = take_number(&mut bi);
                    match na.cmp(&nb) {
                        Ordering::Equal => match ra.cmp(&rb) {
                            Ordering::Equal => continue,
                            o => return o,
                        },
                        o => return o,
                    }
                } else {
                    let acl = ac.to_ascii_lowercase();
                    let bcl = bc.to_ascii_lowercase();
                    ai.next();
                    bi.next();
                    match acl.cmp(&bcl) {
                        Ordering::Equal => continue,
                        o => return o,
                    }
                }
            }
        }
    }
}

fn take_number<I: Iterator<Item = char>>(
    it: &mut std::iter::Peekable<I>,
) -> (u64, usize) {
    let mut digits = String::new();
    while let Some(c) = it.peek() {
        if c.is_ascii_digit() {
            digits.push(*c);
            it.next();
        } else {
            break;
        }
    }
    let len = digits.len();
    (digits.parse::<u64>().unwrap_or(0), len)
}

/// Desired state for one group, identified by `folder_path`.
#[derive(Debug, Clone)]
pub(crate) struct DesiredGroup {
    pub parent_folder_path: Option<String>,
    pub title: String,
    pub position: i32,
    pub folder_path: String,
    pub poster_path: Option<String>,
}

/// Desired state for one item, identified by `file_path`.
#[derive(Debug, Clone)]
pub(crate) struct DesiredItem {
    pub parent_folder_path: Option<String>,
    pub title: String,
    pub position: i32,
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_path: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

/// Reconcile DB state with the desired state computed by a per-kind scanner.
/// `desired_groups` must be ordered with parents before children.
pub(crate) fn reconcile(
    library_id: i64,
    desired_groups: &[DesiredGroup],
    desired_items: &[DesiredItem],
    db: &Database,
) -> Result<ScanResult> {
    use std::collections::{HashMap, HashSet};

    use crate::db::UpsertKind;

    let existing_groups = db.list_groups_by_library(library_id)?;
    let existing_items = db.list_items_by_library(library_id)?;

    let desired_group_paths: HashSet<&str> =
        desired_groups.iter().map(|g| g.folder_path.as_str()).collect();
    let desired_item_paths: HashSet<&str> =
        desired_items.iter().map(|i| i.file_path.as_str()).collect();

    let mut result = ScanResult::default();

    // Insert / update groups in declared order so parents resolve first.
    let mut path_to_id: HashMap<String, i64> = HashMap::new();
    for g in desired_groups {
        let parent_id = match &g.parent_folder_path {
            Some(p) => Some(*path_to_id.get(p).ok_or_else(|| {
                anyhow::anyhow!(
                    "scanner produced group `{}` whose parent `{}` was not yet defined",
                    g.folder_path,
                    p
                )
            })?),
            None => None,
        };
        let r = db.upsert_group_by_folder_path(
            library_id,
            parent_id,
            &g.title,
            g.position,
            &g.folder_path,
            g.poster_path.as_deref(),
        )?;
        path_to_id.insert(g.folder_path.clone(), r.id);
        match r.kind {
            UpsertKind::Inserted => result.groups_added += 1,
            UpsertKind::Updated | UpsertKind::Unchanged => {}
        }
    }

    // Items.
    for it in desired_items {
        let parent_id = match &it.parent_folder_path {
            Some(p) => Some(*path_to_id.get(p).ok_or_else(|| {
                anyhow::anyhow!(
                    "scanner produced item `{}` whose group `{}` was not registered",
                    it.file_path,
                    p
                )
            })?),
            None => None,
        };
        let r = db.upsert_item_by_file_path(
            library_id,
            parent_id,
            &it.title,
            it.position,
            &it.file_path,
            it.duration_seconds,
            it.thumbnail_path.as_deref(),
            it.season_number,
            it.episode_number,
        )?;
        match r.kind {
            UpsertKind::Inserted => result.items_added += 1,
            UpsertKind::Updated => result.items_updated += 1,
            UpsertKind::Unchanged => {}
        }
    }

    // Delete items no longer present.
    for it in &existing_items {
        if !desired_item_paths.contains(it.file_path.as_str()) {
            db.delete_item_by_id(it.id)?;
            result.items_removed += 1;
        }
    }
    // Delete groups no longer present (children first, by descending depth).
    let mut to_delete: Vec<&Group> = existing_groups
        .iter()
        .filter(|g| !desired_group_paths.contains(g.folder_path.as_str()))
        .collect();
    // Approximate child-first: delete leaves first by sorting by parent_id desc.
    to_delete.sort_by_key(|g| -(g.parent_group_id.unwrap_or(0)));
    for g in to_delete {
        db.delete_group_by_id(g.id)?;
        result.groups_removed += 1;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_title_strips_prefix_and_tags() {
        let cases = [
            ("01 - Intro to Rust.mp4", "Intro to Rust"),
            ("01. Variables.mkv", "Variables"),
            ("12 The End.webm", "The End"),
            ("Movie.2023.1080p.BluRay.x264.mp4", "Movie 2023"),
            ("Some Movie [2024] [1080p].mkv", "Some Movie"),
            ("readme.md", "readme"),
        ];
        for (input, want) in cases {
            assert_eq!(clean_title(input), want, "input={input}");
        }
    }

    #[test]
    fn parse_season_episode_variants() {
        assert_eq!(
            parse_season_episode("Show S01E03 Title.mkv"),
            (Some(1), Some(3), "Show Title".to_string())
        );
        assert_eq!(
            parse_season_episode("show.s01e03.web.mkv"),
            (Some(1), Some(3), "show".to_string())
        );
        assert_eq!(
            parse_season_episode("Show 1x03 Title.mp4"),
            (Some(1), Some(3), "Show Title".to_string())
        );
        assert_eq!(
            parse_season_episode("Some movie no marker.mkv"),
            (None, None, "Some movie no marker".to_string())
        );
    }

    #[test]
    fn parse_season_folder_variants() {
        assert_eq!(parse_season_folder("Season 3"), Some(3));
        assert_eq!(parse_season_folder("season 12"), Some(12));
        assert_eq!(parse_season_folder("Temporada 1"), Some(1));
        assert_eq!(parse_season_folder("S03"), Some(3));
        assert_eq!(parse_season_folder("not a season"), None);
    }

    #[test]
    fn natural_sort_orders_numerics() {
        let mut v = vec!["item 10", "item 2", "item 1", "item 20"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["item 1", "item 2", "item 10", "item 20"]);
    }

    #[test]
    fn parse_position_finds_leading_number() {
        assert_eq!(parse_position("01 - Intro").0, 1);
        assert_eq!(parse_position("12. End").0, 12);
        assert_eq!(parse_position("No prefix").0, i32::MAX);
    }

    #[test]
    fn is_video_file_matches_known_extensions() {
        assert!(is_video_file(Path::new("/x/foo.mp4")));
        assert!(is_video_file(Path::new("/x/foo.MKV")));
        assert!(!is_video_file(Path::new("/x/foo.txt")));
        assert!(!is_video_file(Path::new("/x/foo")));
    }

    fn touch(p: &Path) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, b"").unwrap();
    }

    #[test]
    fn courses_scan_builds_two_level_tree_and_preserves_progress() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Course 1 with two modules and three lessons total.
        touch(&root.join("01 - Rust").join("01 - Intro").join("01 - Hello.mp4"));
        touch(&root.join("01 - Rust").join("01 - Intro").join("02 - Vars.mp4"));
        touch(&root.join("01 - Rust").join("02 - Ownership").join("01 - Borrows.mp4"));
        // Course 2 with no modules — should get implicit "Main".
        touch(&root.join("02 - Bash").join("01 - Pipes.mp4"));

        let db = Database::new(&tmp.path().join("db.sqlite")).unwrap();
        let lib = db
            .insert_library("Tutorials", root.to_str().unwrap(), LibraryKind::Courses)
            .unwrap();

        let r1 = scan(&lib, &db).unwrap();
        assert_eq!(r1.items_added, 4, "first scan adds all items");
        assert_eq!(r1.items_removed, 0);

        // Capture an item's id and pretend the user watched it.
        let items = db.list_items_by_library(lib.id).unwrap();
        let target = items
            .iter()
            .find(|i| i.title.contains("Hello"))
            .expect("Hello item present");
        db.upsert_progress(target.id, 42.0, false).unwrap();

        // Re-scan: incremental, no new items.
        let r2 = scan(&lib, &db).unwrap();
        assert_eq!(r2.items_added, 0);
        assert_eq!(r2.items_removed, 0);

        // Progress preserved by id (since file_path didn't change).
        let p = db.get_progress_by_item(target.id).unwrap().unwrap();
        assert_eq!(p.position_seconds, 42.0);

        // Delete one file → next scan removes its row.
        std::fs::remove_file(target.file_path.clone()).unwrap();
        let r3 = scan(&lib, &db).unwrap();
        assert_eq!(r3.items_removed, 1);
        assert!(db.get_item_by_id(target.id).unwrap().is_none());
    }

    #[test]
    fn courses_scan_handles_arbitrary_nesting_depth() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Three levels: course → module → submodule → video
        touch(
            &root
                .join("01 Java")
                .join("01 Ambientação")
                .join("01 Boas vindas")
                .join("01-aula.mp4"),
        );
        touch(
            &root
                .join("01 Java")
                .join("01 Ambientação")
                .join("02 Setup")
                .join("02-aula.mp4"),
        );
        // Four levels: course → bucket → module → submodule → video
        touch(
            &root
                .join("01 Java")
                .join("03 Backend")
                .join("videos")
                .join("01-modulo")
                .join("01-intro.mp4"),
        );
        // Video directly inside the course (no submodule chain)
        touch(&root.join("02 Bash").join("01-pipes.mp4"));

        let db = Database::new(&tmp.path().join("db.sqlite")).unwrap();
        let lib = db
            .insert_library("C", root.to_str().unwrap(), LibraryKind::Courses)
            .unwrap();

        scan(&lib, &db).unwrap();

        let items = db.list_items_by_library(lib.id).unwrap();
        assert_eq!(
            items.len(),
            4,
            "all videos at any depth must be picked up"
        );

        let groups = db.list_top_level_groups(lib.id).unwrap();
        let java = groups.iter().find(|g| g.title == "Java").unwrap();
        // `01 Java` subtree contains 3 of the 4 videos.
        assert_eq!(java.item_count, 3);
    }

    #[test]
    fn series_scan_recognizes_season_folders_and_sxxexx() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Show").join("Season 1").join("Show.S01E01.Pilot.mkv"));
        touch(&root.join("Show").join("Season 1").join("Show.S01E02.Boom.mkv"));
        touch(&root.join("Show").join("Season 2").join("Show.S02E01.Return.mkv"));

        let db = Database::new(&tmp.path().join("db.sqlite")).unwrap();
        let lib = db
            .insert_library("Series", root.to_str().unwrap(), LibraryKind::Series)
            .unwrap();
        scan(&lib, &db).unwrap();

        let items = db.list_items_by_library(lib.id).unwrap();
        assert_eq!(items.len(), 3);
        let ep = items.iter().find(|i| i.title.contains("Pilot")).unwrap();
        assert_eq!(ep.season_number, Some(1));
        assert_eq!(ep.episode_number, Some(1));
    }

    #[test]
    fn movies_scan_handles_flat_and_single_video_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Flat Movie 2023.mp4"));
        touch(&root.join("Foldered Movie [2024]").join("movie.mkv"));

        let db = Database::new(&tmp.path().join("db.sqlite")).unwrap();
        let lib = db
            .insert_library("Movies", root.to_str().unwrap(), LibraryKind::Movies)
            .unwrap();
        scan(&lib, &db).unwrap();

        let items = db.list_items_by_library(lib.id).unwrap();
        assert_eq!(items.len(), 2);
        for it in items {
            assert!(it.group_id.is_none(), "movies have no group");
        }
    }
}

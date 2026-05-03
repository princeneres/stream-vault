// Generic: recursive mirror. Every folder => group (parent chained via
// parent_group_id). Every video file => item. No parsing assumptions —
// titles are folder/file names with extension stripped.

use std::path::{Path, PathBuf};

use anyhow::Result;

use super::{clean_title, is_video_file, reconcile, DesiredGroup, DesiredItem};
use crate::db::Database;
use crate::models::{Library, ScanResult};

pub fn scan(library: &Library, db: &Database) -> Result<ScanResult> {
    let root = Path::new(&library.root_path);
    if !root.is_dir() {
        log::warn!("library root missing: {}", root.display());
        return Ok(ScanResult::default());
    }

    let mut groups: Vec<DesiredGroup> = Vec::new();
    let mut items: Vec<DesiredItem> = Vec::new();

    walk(root, None, &mut groups, &mut items)?;

    reconcile(library.id, &groups, &items, db)
}

fn walk(
    dir: &Path,
    parent_folder_path: Option<String>,
    groups: &mut Vec<DesiredGroup>,
    items: &mut Vec<DesiredItem>,
) -> Result<()> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    entries.sort();

    let mut group_pos = 0i32;
    let mut item_pos = 0i32;

    for entry in &entries {
        if entry.is_dir() {
            group_pos += 1;
            let title_raw = file_name_str(entry);
            let title = clean_title(&title_raw);
            let folder = path_to_string(entry);
            groups.push(DesiredGroup {
                parent_folder_path: parent_folder_path.clone(),
                title: if title.is_empty() { title_raw } else { title },
                position: group_pos,
                folder_path: folder.clone(),
                poster_path: None,
            });
            walk(entry, Some(folder), groups, items)?;
        }
    }

    for entry in &entries {
        if entry.is_file() && is_video_file(entry) {
            item_pos += 1;
            let raw = file_name_str(entry);
            let title = clean_title(&raw);
            items.push(DesiredItem {
                parent_folder_path: parent_folder_path.clone(),
                title: if title.is_empty() { raw } else { title },
                position: item_pos,
                file_path: path_to_string(entry),
                duration_seconds: None,
                thumbnail_path: None,
                season_number: None,
                episode_number: None,
            });
        }
    }

    Ok(())
}

fn file_name_str(p: &Path) -> String {
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

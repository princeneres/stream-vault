// Movies: flat. Either video files directly under root, or sub-folders
// holding a single video (folder name = title). All items have group_id
// = NULL. Title cleaning strips release tags.

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

    let groups: Vec<DesiredGroup> = Vec::new();
    let mut items: Vec<DesiredItem> = Vec::new();

    let mut entries: Vec<PathBuf> = std::fs::read_dir(root)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    entries.sort();

    let mut position = 0i32;

    for entry in entries {
        if entry.is_file() && is_video_file(&entry) {
            position += 1;
            let raw = file_name_str(&entry);
            let title = clean_title(&raw);
            items.push(DesiredItem {
                parent_folder_path: None,
                title: if title.is_empty() { raw } else { title },
                position,
                file_path: path_to_string(&entry),
                duration_seconds: None,
                thumbnail_path: None,
                season_number: None,
                episode_number: None,
            });
        } else if entry.is_dir() {
            let videos: Vec<PathBuf> = std::fs::read_dir(&entry)?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_file() && is_video_file(p))
                .collect();
            if videos.len() == 1 {
                let video = &videos[0];
                position += 1;
                let folder_name = file_name_str(&entry);
                let title = clean_title(&folder_name);
                items.push(DesiredItem {
                    parent_folder_path: None,
                    title: if title.is_empty() { folder_name } else { title },
                    position,
                    file_path: path_to_string(video),
                    duration_seconds: None,
                    thumbnail_path: None,
                    season_number: None,
                    episode_number: None,
                });
            } else if videos.len() > 1 {
                log::warn!(
                    "movies: folder `{}` has {} videos; expected 0 or 1, skipping",
                    entry.display(),
                    videos.len()
                );
            }
        }
    }

    reconcile(library.id, &groups, &items, db)
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

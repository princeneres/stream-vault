// Courses: recursive. Every folder under the library root is a group.
// Folders nest arbitrarily (course → module → submodule → ...). Video
// files are placed under the group of their immediate parent folder.
// Position is parsed from a leading numeric prefix (`01 - `, `02_`, ...)
// when present; otherwise siblings get a sequential 1-based fallback.

use std::path::{Path, PathBuf};

use anyhow::Result;

use super::{
    clean_title, is_video_file, parse_position, reconcile, DesiredGroup, DesiredItem,
};
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

    let mut course_dirs = list_dirs(root)?;
    course_dirs.sort();

    for (idx, course_dir) in course_dirs.iter().enumerate() {
        walk(course_dir, None, idx as i32, &mut groups, &mut items)?;
    }

    reconcile(library.id, &groups, &items, db)
}

fn walk(
    dir: &Path,
    parent_folder_path: Option<String>,
    sibling_index: i32,
    groups: &mut Vec<DesiredGroup>,
    items: &mut Vec<DesiredItem>,
) -> Result<()> {
    let raw_name = file_name_str(dir);
    let (pos_raw, title_raw) = parse_position(&raw_name);
    let title = clean_title(&title_raw);
    let position = if pos_raw == i32::MAX {
        sibling_index + 1
    } else {
        pos_raw
    };
    let folder_path = path_to_string(dir);

    groups.push(DesiredGroup {
        parent_folder_path,
        title: if title.is_empty() {
            raw_name.clone()
        } else {
            title
        },
        position,
        folder_path: folder_path.clone(),
        poster_path: None,
    });

    let mut subdirs = list_dirs(dir)?;
    subdirs.sort();
    for (sub_idx, subdir) in subdirs.iter().enumerate() {
        walk(
            subdir,
            Some(folder_path.clone()),
            sub_idx as i32,
            groups,
            items,
        )?;
    }

    let mut files = list_files(dir)?;
    files.sort();
    let mut item_idx: i32 = 0;
    for file in &files {
        if !is_video_file(file) {
            continue;
        }
        let raw = file_name_str(file);
        let (pos_raw, rest) = parse_position(&raw);
        let title = clean_title(&rest);
        let position = if pos_raw == i32::MAX {
            item_idx + 1
        } else {
            pos_raw
        };
        items.push(DesiredItem {
            parent_folder_path: Some(folder_path.clone()),
            title: if title.is_empty() { raw } else { title },
            position,
            file_path: path_to_string(file),
            duration_seconds: None,
            thumbnail_path: None,
            season_number: None,
            episode_number: None,
        });
        item_idx += 1;
    }

    Ok(())
}

fn list_dirs(p: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(p)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            out.push(entry.path());
        }
    }
    Ok(out)
}

fn list_files(p: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(p)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            out.push(entry.path());
        }
    }
    Ok(out)
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

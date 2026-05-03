// Courses: 2-level. Top-level folder = course. Sub-folder = module. Files
// inside modules = items. If a course has no sub-folders, an implicit
// `Main` module is synthesized to host its videos directly.

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

    for (course_idx, course_dir) in course_dirs.iter().enumerate() {
        let course_name = file_name_str(course_dir);
        let (course_pos_raw, course_title_raw) = parse_position(&course_name);
        let course_title = clean_title(&course_title_raw);
        let course_position = if course_pos_raw == i32::MAX {
            (course_idx as i32) + 1
        } else {
            course_pos_raw
        };
        let course_folder = path_to_string(course_dir);
        groups.push(DesiredGroup {
            parent_folder_path: None,
            title: if course_title.is_empty() {
                course_name.clone()
            } else {
                course_title
            },
            position: course_position,
            folder_path: course_folder.clone(),
            poster_path: None,
        });

        let mut module_dirs = list_dirs(course_dir)?;
        module_dirs.sort();

        if module_dirs.is_empty() {
            // Implicit "Main" module so direct videos still belong to a group.
            let implicit_path = format!("{course_folder}//Main");
            groups.push(DesiredGroup {
                parent_folder_path: Some(course_folder.clone()),
                title: "Main".to_string(),
                position: 1,
                folder_path: implicit_path.clone(),
                poster_path: None,
            });
            collect_videos(course_dir, &implicit_path, &mut items)?;
        } else {
            for (module_idx, module_dir) in module_dirs.iter().enumerate() {
                let module_name = file_name_str(module_dir);
                let (module_pos_raw, module_title_raw) = parse_position(&module_name);
                let module_title = clean_title(&module_title_raw);
                let module_position = if module_pos_raw == i32::MAX {
                    (module_idx as i32) + 1
                } else {
                    module_pos_raw
                };
                let module_folder = path_to_string(module_dir);
                groups.push(DesiredGroup {
                    parent_folder_path: Some(course_folder.clone()),
                    title: if module_title.is_empty() {
                        module_name
                    } else {
                        module_title
                    },
                    position: module_position,
                    folder_path: module_folder.clone(),
                    poster_path: None,
                });
                collect_videos(module_dir, &module_folder, &mut items)?;
            }
        }
    }

    reconcile(library.id, &groups, &items, db)
}

fn collect_videos(
    dir: &Path,
    parent_folder_path: &str,
    out: &mut Vec<DesiredItem>,
) -> Result<()> {
    let mut files = list_files(dir)?;
    files.sort();
    for (idx, file) in files.iter().enumerate() {
        if !is_video_file(file) {
            continue;
        }
        let raw = file_name_str(file);
        let (pos_raw, rest) = parse_position(&raw);
        let title = clean_title(&rest);
        let position = if pos_raw == i32::MAX {
            (idx as i32) + 1
        } else {
            pos_raw
        };
        out.push(DesiredItem {
            parent_folder_path: Some(parent_folder_path.to_string()),
            title: if title.is_empty() { raw } else { title },
            position,
            file_path: path_to_string(file),
            duration_seconds: None,
            thumbnail_path: None,
            season_number: None,
            episode_number: None,
        });
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

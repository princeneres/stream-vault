// Series: 2-level. Top-level folder = series. Sub-folder matching
// `Season N` / `S01` / `Temporada N` = season. Episode files parse
// SxxExx / 1x03 to populate season/episode + clean title. If no season
// folders, an implicit `Season 1` is synthesized.

use std::path::{Path, PathBuf};

use anyhow::Result;

use super::{
    clean_title, is_video_file, parse_position, parse_season_episode,
    parse_season_folder, reconcile, DesiredGroup, DesiredItem,
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

    let mut series_dirs = list_dirs(root)?;
    series_dirs.sort();

    for (series_idx, series_dir) in series_dirs.iter().enumerate() {
        let series_name = file_name_str(series_dir);
        let series_title = clean_title(&series_name);
        let series_position = (series_idx as i32) + 1;
        let series_folder = path_to_string(series_dir);
        groups.push(DesiredGroup {
            parent_folder_path: None,
            title: if series_title.is_empty() {
                series_name.clone()
            } else {
                series_title
            },
            position: series_position,
            folder_path: series_folder.clone(),
            poster_path: None,
        });

        let mut season_dirs = list_dirs(series_dir)?;
        season_dirs.sort();
        let identified: Vec<(PathBuf, i32)> = season_dirs
            .iter()
            .filter_map(|d| parse_season_folder(&file_name_str(d)).map(|n| (d.clone(), n)))
            .collect();

        if identified.is_empty() {
            // No season folders — implicit Season 1 hosting all videos under
            // the series folder (recursively, in case the layout is messy).
            let implicit_path = format!("{series_folder}//Season-1");
            groups.push(DesiredGroup {
                parent_folder_path: Some(series_folder.clone()),
                title: "Season 1".to_string(),
                position: 1,
                folder_path: implicit_path.clone(),
                poster_path: None,
            });
            collect_episodes(series_dir, &implicit_path, Some(1), &mut items)?;
        } else {
            for (season_dir, season_no) in &identified {
                let season_folder = path_to_string(season_dir);
                groups.push(DesiredGroup {
                    parent_folder_path: Some(series_folder.clone()),
                    title: format!("Season {season_no}"),
                    position: *season_no,
                    folder_path: season_folder.clone(),
                    poster_path: None,
                });
                collect_episodes(season_dir, &season_folder, Some(*season_no), &mut items)?;
            }
        }
    }

    reconcile(library.id, &groups, &items, db)
}

fn collect_episodes(
    dir: &Path,
    parent_folder_path: &str,
    fallback_season: Option<i32>,
    out: &mut Vec<DesiredItem>,
) -> Result<()> {
    let mut files = list_files_recursive(dir)?;
    files.sort();
    for (idx, file) in files.iter().enumerate() {
        if !is_video_file(file) {
            continue;
        }
        let raw = file_name_str(file);
        let (parsed_season, episode, parsed_title) = parse_season_episode(&raw);
        let title = if parsed_title.is_empty() {
            raw.clone()
        } else {
            parsed_title
        };
        let position = match (parsed_season, episode) {
            (_, Some(e)) => e,
            _ => {
                let (n, _) = parse_position(&raw);
                if n == i32::MAX {
                    (idx as i32) + 1
                } else {
                    n
                }
            }
        };
        out.push(DesiredItem {
            parent_folder_path: Some(parent_folder_path.to_string()),
            title,
            position,
            file_path: path_to_string(file),
            duration_seconds: None,
            thumbnail_path: None,
            season_number: parsed_season.or(fallback_season),
            episode_number: episode,
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

fn list_files_recursive(p: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(p).follow_links(false).into_iter().flatten() {
        if entry.file_type().is_file() {
            out.push(entry.into_path());
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

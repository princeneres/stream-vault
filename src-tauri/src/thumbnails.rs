// ffmpeg thumbnail / poster generation + ffprobe duration probe.
//
// Synchronous (called from the scanner). Failures from missing ffmpeg /
// ffprobe surface as `Err` with a clear message; callers treat them as
// non-fatal and skip the artwork rather than aborting the scan.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Context, Result};

use crate::models::{Group, Item};

const POSTER_FILENAMES: &[&str] = &[
    "poster.jpg",
    "poster.png",
    "cover.jpg",
    "cover.png",
    "folder.jpg",
    "folder.png",
];

/// Generate a JPEG thumbnail for `item` under `output_dir`. Returns the path
/// of the generated file. The output is named `<id>.jpg`.
pub fn generate_thumbnail(item: &Item, output_dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("creating thumbnail dir {output_dir:?}"))?;
    let out_path = output_dir.join(format!("{}.jpg", item.id));
    let seek = thumbnail_seek_seconds(item.duration_seconds);
    run_ffmpeg_thumbnail(Path::new(&item.file_path), seek, &out_path)?;
    Ok(out_path)
}

/// Pick a poster for `group`. Tries on-disk filenames in `group.folder_path`
/// first; otherwise generates a thumbnail from the first available item.
pub fn generate_poster(
    group: &Group,
    items: &[Item],
    output_dir: &Path,
) -> Result<PathBuf> {
    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("creating poster dir {output_dir:?}"))?;

    let folder = Path::new(&group.folder_path);
    for name in POSTER_FILENAMES {
        let candidate = folder.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    let first = items
        .first()
        .ok_or_else(|| anyhow!("no items available to derive a poster for group {}", group.id))?;
    let out_path = output_dir.join(format!("group-{}.jpg", group.id));
    let seek = thumbnail_seek_seconds(first.duration_seconds);
    run_ffmpeg_thumbnail(Path::new(&first.file_path), seek, &out_path)?;
    Ok(out_path)
}

/// Probe a media file's duration in seconds via `ffprobe`.
pub fn probe_duration(file_path: &Path) -> Result<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(file_path)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                anyhow!("ffprobe is not installed; skipping duration probe")
            } else {
                anyhow!("ffprobe failed to start: {e}")
            }
        })?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffprobe exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let trimmed = s.trim();
    trimmed
        .parse::<f64>()
        .map_err(|_| anyhow!("ffprobe produced non-numeric duration: {trimmed:?}"))
}

fn run_ffmpeg_thumbnail(file_path: &Path, seek: f64, out_path: &Path) -> Result<()> {
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-ss").arg(format!("{seek}"))
        .arg("-i").arg(file_path)
        .arg("-vframes").arg("1")
        .arg("-q:v").arg("3")
        .arg(out_path)
        .status()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                anyhow!("ffmpeg is not installed; skipping thumbnail")
            } else {
                anyhow!("ffmpeg failed to start: {e}")
            }
        })?;
    if !status.success() {
        return Err(anyhow!(
            "ffmpeg exited with status {} while generating {}",
            status,
            out_path.display()
        ));
    }
    Ok(())
}

fn thumbnail_seek_seconds(duration: Option<f64>) -> f64 {
    match duration {
        Some(d) if d > 0.0 => (d * 0.10).max(0.5),
        _ => 30.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_group() -> Group {
        Group {
            id: 1,
            library_id: 1,
            parent_group_id: None,
            title: "g".to_string(),
            position: 0,
            folder_path: "/tmp/no-such-dir-streamvault".to_string(),
            poster_path: None,
            item_count: 0,
            completed_count: 0,
        }
    }

    #[test]
    fn poster_uses_existing_cover_if_present() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_path_buf();
        fs::write(folder.join("cover.jpg"), b"fake").unwrap();

        let mut group = make_group();
        group.folder_path = folder.to_string_lossy().to_string();

        let out = tempfile::tempdir().unwrap();
        let res = generate_poster(&group, &[], out.path()).unwrap();
        assert_eq!(res, folder.join("cover.jpg"));
    }

    #[test]
    fn poster_prefers_poster_over_cover() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_path_buf();
        fs::write(folder.join("cover.jpg"), b"x").unwrap();
        fs::write(folder.join("poster.jpg"), b"x").unwrap();

        let mut group = make_group();
        group.folder_path = folder.to_string_lossy().to_string();

        let out = tempfile::tempdir().unwrap();
        let res = generate_poster(&group, &[], out.path()).unwrap();
        assert_eq!(res, folder.join("poster.jpg"));
    }

    #[test]
    fn poster_errors_when_no_files_no_items() {
        let dir = tempfile::tempdir().unwrap();
        let mut group = make_group();
        group.folder_path = dir.path().to_string_lossy().to_string();
        let out = tempfile::tempdir().unwrap();
        assert!(generate_poster(&group, &[], out.path()).is_err());
    }

    #[test]
    fn thumbnail_seek_picks_10_percent_or_30s_fallback() {
        assert_eq!(thumbnail_seek_seconds(Some(600.0)), 60.0);
        assert_eq!(thumbnail_seek_seconds(None), 30.0);
        assert_eq!(thumbnail_seek_seconds(Some(0.0)), 30.0);
        assert_eq!(thumbnail_seek_seconds(Some(2.0)), 0.5);
    }
}

// TODO(player-eng): ffmpeg thumbnail/poster + ffprobe duration.
//
// Public API (called by scanner via Backend Engineer):
//   pub fn generate_thumbnail(item: &Item, output_dir: &Path) -> Result<PathBuf>
//   pub fn generate_poster(group: &Group, items: &[Item], output_dir: &Path) -> Result<PathBuf>
//   pub fn probe_duration(file_path: &Path) -> Result<f64>
//
// - Output under <app_data>/media/<id>.jpg via tauri::api::path::app_data_dir.
// - poster: prefer poster.jpg|cover.jpg in folder, else thumbnail of first item.
// - thumbnail: ffmpeg -ss <10% of duration | 30s> -i <file> -vframes 1 -q:v 3 <out>.
// - ffmpeg/ffprobe missing: log + skip; do NOT fail scan.
//
// See plan, Agent D.

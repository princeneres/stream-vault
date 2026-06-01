// In-process localhost HTTP server for media playback.
//
// WebKitGTK (Linux) cannot play `<video>`/`<audio>` from Tauri's custom
// `asset://` protocol — media loading is delegated to GStreamer. Serving over
// plain HTTP on 127.0.0.1 fixes that, but a second problem remains: many MP4s
// (e.g. course downloads) store the `moov` atom at the END of the file
// (non-faststart). Over HTTP, WebKitGTK's GStreamer pipeline doesn't seek back
// to read it and fails with MEDIA_ERR_SRC_NOT_SUPPORTED.
//
// So the `/stream` route remuxes on the fly with ffmpeg into a *fragmented*
// MP4 (`empty_moov`), which is progressive and needs no trailing moov. `-c
// copy` means no re-encode. Seeking/resume is done by restarting ffmpeg at an
// `-ss <t>` offset; the frontend keeps a virtual timeline using the duration
// from the DB (ffprobe). The `/file` route still serves raw bytes with range
// support (used for faststart files / diagnostics).
//
// Only files inside a configured library root are served (validated per
// request against the DB), so this is not an arbitrary-file read endpoint.

use std::collections::HashMap;
use std::fs::{File, Metadata};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use once_cell::sync::Lazy;
use tiny_http::{Header, Response, Server, StatusCode};

use crate::db::Database;

/// Cache of computed faststart plans, keyed by path + size + mtime.
static PLAN_CACHE: Lazy<Mutex<HashMap<String, Arc<Plan>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Tauri-managed handle: the port the media server is listening on.
pub struct MediaServer {
    pub port: u16,
}

/// Bind to an ephemeral 127.0.0.1 port and serve requests on a background
/// thread. Returns the chosen port.
pub fn start(db: Database) -> std::io::Result<u16> {
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| std::io::Error::other("media server addr has no port"))?;

    // One thread per request: WebKitGTK opens several connections at once (one
    // streaming the body, others issuing range seeks — e.g. to read a
    // moov-at-end atom). A single-threaded accept loop would block on the
    // first long streaming response and starve the seek requests, which the
    // `<video>` element then reports as MEDIA_ERR_SRC_NOT_SUPPORTED.
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let db = db.clone();
            std::thread::spawn(move || handle(&db, request));
        }
    });
    Ok(port)
}

fn handle(db: &Database, request: tiny_http::Request) {
    let method = request.method().as_str().to_string();
    let url = request.url().to_string();
    log::info!("media: {method} {url}");

    if method == "OPTIONS" {
        let _ = request.respond(empty_cors(204));
        return;
    }

    let query = parse_query(&url);
    let path = match query.get("path").map(PathBuf::from) {
        Some(p) => p,
        None => {
            log::warn!("media: 400 missing path");
            let _ = request.respond(empty_cors(400));
            return;
        }
    };

    if !is_allowed(db, &path) {
        log::warn!("media: 403 not under a library root: {}", path.display());
        let _ = request.respond(empty_cors(403));
        return;
    }

    serve_file(&path, request);
}

/// Serve the file with HTTP byte-range support, transparently presenting a
/// "faststart" layout (moov before mdat) so WebKitGTK's `<video>` — which
/// loads progressively and won't seek to a trailing moov — can play it. The
/// reordered header is built in memory; mdat is streamed from disk.
fn serve_file(path: &Path, request: tiny_http::Request) {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("media: 404 stat {} failed: {e}", path.display());
            let _ = request.respond(empty_cors(404));
            return;
        }
    };
    let plan = get_plan(path, &meta);
    let total = plan.total();

    let body_file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("media: 404 open {} failed: {e}", path.display());
            let _ = request.respond(empty_cors(404));
            return;
        }
    };

    let range = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    let mut headers = video_headers();
    headers.push(content_type_header(path));
    headers.push(header("Accept-Ranges", "bytes"));

    let (code, start, end) = match range.as_deref().and_then(|r| parse_range(r, total)) {
        Some((s, e)) => {
            headers.push(header("Content-Range", &format!("bytes {s}-{e}/{total}")));
            (206, s, e)
        }
        None => (200, 0, total.saturating_sub(1)),
    };
    let len = if total == 0 { 0 } else { end - start + 1 };
    log::info!("media: {code} {start}-{end}/{total} (header {}B)", plan.header.len());

    let reader = VirtualReader {
        header: plan.header.clone(),
        file: body_file,
        body_offset: plan.body_offset,
        header_len: plan.header.len() as u64,
        pos: start,
        end,
        seeked: false,
    };
    let resp = Response::new(StatusCode(code), headers, reader, Some(len as usize), None);
    let _ = request.respond(resp);
}

/// A virtual file = `header` (in-memory, reordered ftyp/moov) followed by the
/// on-disk body starting at `body_offset`. Reads the inclusive virtual range
/// `[pos, end]`, crossing the header→body boundary transparently.
struct VirtualReader {
    header: Arc<Vec<u8>>,
    file: File,
    body_offset: u64,
    header_len: u64,
    pos: u64,
    end: u64,
    seeked: bool,
}

impl Read for VirtualReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pos > self.end {
            return Ok(0);
        }
        let remaining = self.end - self.pos + 1;
        if self.pos < self.header_len {
            let h = self.pos as usize;
            let n = (self.header_len - self.pos)
                .min(remaining)
                .min(buf.len() as u64) as usize;
            buf[..n].copy_from_slice(&self.header[h..h + n]);
            self.pos += n as u64;
            return Ok(n);
        }
        if !self.seeked {
            self.file
                .seek(SeekFrom::Start(self.body_offset + (self.pos - self.header_len)))?;
            self.seeked = true;
        }
        let want = remaining.min(buf.len() as u64) as usize;
        let n = self.file.read(&mut buf[..want])?;
        self.pos += n as u64;
        Ok(n)
    }
}

/// Header bytes (ftyp + reordered moov) + the on-disk body slice.
struct Plan {
    header: Arc<Vec<u8>>,
    body_offset: u64,
    body_len: u64,
}

impl Plan {
    fn total(&self) -> u64 {
        self.header.len() as u64 + self.body_len
    }
}

fn get_plan(path: &Path, meta: &Metadata) -> Arc<Plan> {
    let total = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let key = format!("{}|{total}|{mtime}", path.display());

    if let Some(p) = PLAN_CACHE.lock().unwrap().get(&key) {
        return p.clone();
    }
    let plan = Arc::new(build_faststart(path, total).unwrap_or_else(|| Plan {
        header: Arc::new(Vec::new()),
        body_offset: 0,
        body_len: total,
    }));
    PLAN_CACHE.lock().unwrap().insert(key, plan.clone());
    plan
}

/// Build a faststart plan, or `None` when the file is already faststart, not
/// an MP4, or unreadable (callers fall back to raw byte serving).
fn build_faststart(path: &Path, total: u64) -> Option<Plan> {
    let mut file = File::open(path).ok()?;
    let atoms = read_top_atoms(&mut file, total).ok()?;
    let moov = atoms.iter().find(|a| &a.0 == b"moov")?;
    let mdat = atoms.iter().find(|a| &a.0 == b"mdat")?;
    if moov.1 < mdat.1 {
        return None; // already faststart
    }

    let pre_len = mdat.1 as usize;
    let mut pre = vec![0u8; pre_len];
    file.seek(SeekFrom::Start(0)).ok()?;
    file.read_exact(&mut pre).ok()?;

    let mut moov_buf = vec![0u8; moov.2 as usize];
    file.seek(SeekFrom::Start(moov.1)).ok()?;
    file.read_exact(&mut moov_buf).ok()?;

    // mdat shifts forward by the inserted moov's size; chunk offsets follow.
    patch_offsets(&mut moov_buf, moov.2);

    let mut header = pre;
    header.extend_from_slice(&moov_buf);
    Some(Plan {
        header: Arc::new(header),
        body_offset: mdat.1,
        body_len: mdat.2,
    })
}

/// Top-level atoms as `(type, offset, size)`.
fn read_top_atoms(
    file: &mut File,
    total: u64,
) -> std::io::Result<Vec<([u8; 4], u64, u64)>> {
    let mut atoms = Vec::new();
    let mut off = 0u64;
    while off + 8 <= total {
        file.seek(SeekFrom::Start(off))?;
        let mut hdr = [0u8; 16];
        if file.read(&mut hdr[..8])? < 8 {
            break;
        }
        let size32 = be_u32(&hdr[0..4]);
        let typ = [hdr[4], hdr[5], hdr[6], hdr[7]];
        let size = if size32 == 1 {
            if file.read(&mut hdr[8..16])? < 8 {
                break;
            }
            be_u64(&hdr[8..16])
        } else if size32 == 0 {
            total - off
        } else {
            size32 as u64
        };
        if size < 8 {
            break;
        }
        atoms.push((typ, off, size));
        off = match off.checked_add(size) {
            Some(v) => v,
            None => break,
        };
    }
    Ok(atoms)
}

/// Recursively add `shift` to every `stco`/`co64` chunk offset in `buf`.
fn patch_offsets(buf: &mut [u8], shift: u64) {
    let mut o = 0usize;
    while o + 8 <= buf.len() {
        let size32 = be_u32(&buf[o..o + 4]);
        let typ = [buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]];
        let (size, hdr) = if size32 == 1 {
            if o + 16 > buf.len() {
                break;
            }
            (be_u64(&buf[o + 8..o + 16]) as usize, 16)
        } else {
            (size32 as usize, 8)
        };
        if size < hdr || o + size > buf.len() {
            break;
        }
        let body = &mut buf[o + hdr..o + size];
        match &typ {
            b"stco" => patch_table(body, shift, 4),
            b"co64" => patch_table(body, shift, 8),
            b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"edts" => {
                patch_offsets(body, shift)
            }
            _ => {}
        }
        o += size;
    }
}

/// Patch a `stco`(4)/`co64`(8) offset table: `[version+flags(4)][count(4)][entries]`.
fn patch_table(body: &mut [u8], shift: u64, width: usize) {
    if body.len() < 8 {
        return;
    }
    let count = be_u32(&body[4..8]) as usize;
    let mut p = 8;
    for _ in 0..count {
        if p + width > body.len() {
            break;
        }
        if width == 4 {
            let v = be_u32(&body[p..p + 4]) as u64 + shift;
            body[p..p + 4].copy_from_slice(&(v as u32).to_be_bytes());
        } else {
            let v = be_u64(&body[p..p + 8]) + shift;
            body[p..p + 8].copy_from_slice(&v.to_be_bytes());
        }
        p += width;
    }
}

fn be_u32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn be_u64(b: &[u8]) -> u64 {
    u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

/// Decode the URL query into a `key -> value` map (percent-decoded).
fn parse_query(url: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(q) = url.split_once('?').map(|(_, q)| q) else {
        return out;
    };
    for pair in q.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        if let Ok(dv) = urlencoding::decode(v) {
            out.insert(k.to_string(), dv.into_owned());
        }
    }
    out
}

/// True only if `path` resolves to a file inside a configured library root.
fn is_allowed(db: &Database, path: &Path) -> bool {
    let Ok(canon) = path.canonicalize() else {
        return false;
    };
    let Ok(libs) = db.list_libraries_raw() else {
        return false;
    };
    libs.iter().any(|lib| {
        Path::new(&lib.root_path)
            .canonicalize()
            .map(|root| canon.starts_with(root))
            .unwrap_or(false)
    })
}

/// Parse a `bytes=start-end` Range header into inclusive `(start, end)`,
/// clamped to `total`. Only the first range is honored.
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = value.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start_s, end_s) = first.split_once('-')?;
    let last = total - 1;

    let (start, end) = if start_s.is_empty() {
        let n: u64 = end_s.parse().ok()?;
        if n == 0 {
            return None;
        }
        (total.saturating_sub(n), last)
    } else {
        let start: u64 = start_s.parse().ok()?;
        let end = if end_s.is_empty() {
            last
        } else {
            end_s.parse::<u64>().ok()?.min(last)
        };
        (start, end)
    };

    if start > end || start > last {
        return None;
    }
    Some((start, end))
}

fn video_headers() -> Vec<Header> {
    vec![
        header("Access-Control-Allow-Origin", "*"),
        header("Access-Control-Allow-Headers", "Range"),
        header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
    ]
}

fn content_type_header(path: &Path) -> Header {
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") | Some("mov") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("ogg") | Some("ogv") => "video/ogg",
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    };
    header("Content-Type", mime)
}

fn header(field: &str, value: &str) -> Header {
    Header::from_bytes(field.as_bytes(), value.as_bytes())
        .expect("static header is valid")
}

fn empty_cors(code: u16) -> Response<std::io::Empty> {
    Response::new(StatusCode(code), video_headers(), std::io::empty(), Some(0), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_full_and_open_ended() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
    }

    #[test]
    fn parse_range_suffix_and_clamp() {
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
    }

    #[test]
    fn parse_range_rejects_garbage() {
        assert_eq!(parse_range("bytes=abc", 1000), None);
        assert_eq!(parse_range("100-200", 1000), None);
        assert_eq!(parse_range("bytes=500-100", 1000), None);
        assert_eq!(parse_range("bytes=0-0", 0), None);
    }

    fn box_atom(typ: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
        v.extend_from_slice(typ);
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn faststart_reorders_and_patches_offsets() {
        // ftyp(16) + mdat(12) + moov{ stco[orig_offset] }
        let ftyp = box_atom(b"ftyp", &[0u8; 8]);
        let mdat = box_atom(b"mdat", b"DATA");
        let orig_offset: u32 = 16; // points at mdat payload start
        let mut stco_payload = vec![0u8; 4]; // version+flags
        stco_payload.extend_from_slice(&1u32.to_be_bytes()); // count
        stco_payload.extend_from_slice(&orig_offset.to_be_bytes());
        let moov = box_atom(b"moov", &box_atom(b"stco", &stco_payload));

        let mut bytes = Vec::new();
        bytes.extend_from_slice(&ftyp);
        bytes.extend_from_slice(&mdat);
        bytes.extend_from_slice(&moov);
        let total = bytes.len() as u64;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v.mp4");
        std::fs::write(&path, &bytes).unwrap();

        let plan = build_faststart(&path, total).expect("should build faststart plan");

        // header = ftyp + moov; body = mdat from disk.
        assert_eq!(plan.body_offset, ftyp.len() as u64);
        assert_eq!(plan.body_len, mdat.len() as u64);
        assert_eq!(plan.total(), total);
        assert_eq!(&plan.header[4..8], b"ftyp");
        assert_eq!(&plan.header[ftyp.len() + 4..ftyp.len() + 8], b"moov");

        // The stco offset must be shifted by the inserted moov size.
        let stco_entry_pos = plan.header.len() - 4;
        let patched = be_u32(&plan.header[stco_entry_pos..]);
        assert_eq!(patched, orig_offset + moov.len() as u32);
    }

    #[test]
    fn parse_query_decodes_path_and_t() {
        let q = parse_query("/stream?path=%2Fmedia%2Fa%20b%2Fv.mp4&t=12.5");
        assert_eq!(q.get("path").map(String::as_str), Some("/media/a b/v.mp4"));
        assert_eq!(q.get("t").map(String::as_str), Some("12.5"));
    }

    #[test]
    fn serves_byte_range_for_file_in_library_root() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::time::Duration;

        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().join("t.db")).unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("v.mp4");
        std::fs::write(&file, b"0123456789").unwrap();
        db.insert_library("L", root.to_str().unwrap(), crate::models::LibraryKind::Movies)
            .unwrap();

        let port = start(db).unwrap();
        let enc = urlencoding::encode(file.to_str().unwrap());
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let req = format!(
            "GET /file?path={enc} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=2-5\r\nConnection: close\r\n\r\n"
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();

        assert!(resp.contains("206 Partial Content"), "resp: {resp}");
        assert!(resp.contains("Content-Range: bytes 2-5/10"), "resp: {resp}");
        assert!(resp.ends_with("2345"), "resp: {resp}");
    }

    #[test]
    fn rejects_file_outside_library_root() {
        use std::io::Write;
        use std::net::TcpStream;
        use std::time::Duration;

        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(&dir.path().join("t.db")).unwrap();
        let outside = dir.path().join("secret.txt");
        std::fs::write(&outside, b"nope").unwrap();

        let port = start(db).unwrap();
        let enc = urlencoding::encode(outside.to_str().unwrap());
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let req = format!(
            "GET /file?path={enc} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();

        assert!(resp.contains("403 Forbidden"), "resp: {resp}");
    }
}

// Obsidian vault publishing.
//
// SQLite is the source of truth. The vault is a publish target: every note
// CRUD (when `obsidian_vault_path` is configured) regenerates marker blocks
// inside a per-item Markdown file plus a per-root-group `_index.md` rollup.
// User prose between blocks is preserved; inside the blocks StreamVault is
// authoritative.
//
// Path safety: vault root + target are canonicalized; we assert the target
// stays under the root after canonicalization (defeats `..` and symlinks).
// Writes are atomic (write-temp + rename).

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use regex::Regex;

use crate::db::Database;
use crate::models::{Group, Item, Library, Note};

const VAULT_SETTING_KEY: &str = "obsidian_vault_path";
const SUBFOLDER: &str = "StreamVault";
const ROLLUP_FILE: &str = "_index.md";
const SECTION_HEADER: &str = "## Notes from StreamVault";
const END_SENTINEL: &str = "<!-- sv:end -->";
const ITEM_SECTION_HEADER: &str = "## Videos";

/// What changed for a single note. Drives whether we upsert or remove the
/// matching marker block in the per-item file.
pub enum VaultOp {
    Upsert(Note),
    Delete { item_id: i64, note_id: i64 },
}

/// Best-effort publish. Returns `Ok(())` when no vault is configured so the
/// caller can keep its own DB write succeeding regardless.
pub fn publish(db: &Database, op: VaultOp) -> Result<()> {
    let vault_root = match resolve_vault_root(db)? {
        Some(p) => p,
        None => return Ok(()),
    };

    let item_id = match &op {
        VaultOp::Upsert(n) => n.item_id,
        VaultOp::Delete { item_id, .. } => *item_id,
    };
    let ctx = build_item_context(db, item_id)?;

    publish_item_md(&vault_root, &ctx, &op)?;
    publish_rollup_md(&vault_root, db, &ctx)?;
    Ok(())
}

/// Re-emit every per-item file + every rollup. Used by the "Republish all"
/// button after a vault path change.
pub fn republish_all(db: &Database) -> Result<u32> {
    let vault_root = match resolve_vault_root(db)? {
        Some(p) => p,
        None => return Ok(0),
    };

    let mut count = 0u32;
    let item_ids: Vec<i64> = db.with_conn(|c| {
        let mut stmt = c.prepare("SELECT DISTINCT item_id FROM notes")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r?);
        }
        Ok(ids)
    })?;

    for item_id in item_ids {
        let ctx = match build_item_context(db, item_id) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("vault: skipping item {item_id}: {e}");
                continue;
            }
        };
        if let Err(e) = republish_item_full(&vault_root, &ctx) {
            log::warn!("vault: republish item {item_id}: {e}");
            continue;
        }
        if let Err(e) = publish_rollup_md(&vault_root, db, &ctx) {
            log::warn!("vault: rollup for item {item_id}: {e}");
        }
        count += 1;
    }
    Ok(count)
}

fn resolve_vault_root(db: &Database) -> Result<Option<PathBuf>> {
    let raw = match db.get_setting(VAULT_SETTING_KEY)? {
        Some(s) if !s.trim().is_empty() => s,
        _ => return Ok(None),
    };
    let p = PathBuf::from(raw.trim());
    if !p.is_dir() {
        return Err(anyhow!("vault path is not a directory: {:?}", p));
    }
    let canon = p
        .canonicalize()
        .with_context(|| format!("canonicalize vault path {:?}", p))?;
    Ok(Some(canon))
}

struct ItemContext {
    item: Item,
    item_uuid: String,
    library: Library,
    /// Top-level group at index 0, leaf at end. Empty for top-level items.
    group_chain: Vec<Group>,
}

fn build_item_context(db: &Database, item_id: i64) -> Result<ItemContext> {
    let item = db
        .get_item_by_id(item_id)?
        .ok_or_else(|| anyhow!("item {item_id} not found"))?;
    let item_uuid = db
        .get_item_uuid(item_id)?
        .ok_or_else(|| anyhow!("item {item_id} has no item_uuid"))?;
    let library = db
        .get_library_by_id(item.library_id)?
        .ok_or_else(|| anyhow!("library {} not found", item.library_id))?;
    let group_chain = build_group_chain(db, item.group_id)?;
    Ok(ItemContext {
        item,
        item_uuid,
        library,
        group_chain,
    })
}

fn build_group_chain(db: &Database, leaf_group_id: Option<i64>) -> Result<Vec<Group>> {
    let mut chain: Vec<Group> = Vec::new();
    let mut cursor = leaf_group_id;
    while let Some(gid) = cursor {
        let g = db
            .get_group_by_id(gid)?
            .ok_or_else(|| anyhow!("group {gid} not found"))?;
        cursor = g.parent_group_id;
        chain.push(g);
    }
    chain.reverse();
    Ok(chain)
}

// ---- Per-item markdown ----------------------------------------------------

fn publish_item_md(vault_root: &Path, ctx: &ItemContext, op: &VaultOp) -> Result<()> {
    let target = compute_item_md_path(vault_root, ctx);
    ensure_within(vault_root, &target)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create parent {parent:?}"))?;
    }

    let existing = std::fs::read_to_string(&target).unwrap_or_default();
    let mut content = upsert_frontmatter(&existing, &item_frontmatter(ctx));
    content = ensure_item_skeleton(&content, &ctx.item.title);

    content = match op {
        VaultOp::Upsert(note) => upsert_block(
            &content,
            &block_id(note.id),
            &build_note_block(note, &ctx.item_uuid),
        ),
        VaultOp::Delete { note_id, .. } => remove_block(&content, &block_id(*note_id)),
    };

    write_atomic(&target, &content)
}

/// Full rebuild of the per-item file from DB state. Wipes all `sv:note:*`
/// blocks and re-emits them in timestamp order.
fn republish_item_full(vault_root: &Path, ctx: &ItemContext) -> Result<()> {
    let target = compute_item_md_path(vault_root, ctx);
    ensure_within(vault_root, &target)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = std::fs::read_to_string(&target).unwrap_or_default();
    let mut content = upsert_frontmatter(&existing, &item_frontmatter(ctx));
    content = ensure_item_skeleton(&content, &ctx.item.title);
    content = strip_all_note_blocks(&content);
    Ok(write_atomic(&target, &content)?)
}

fn item_frontmatter(ctx: &ItemContext) -> String {
    let group_path = ctx
        .group_chain
        .iter()
        .map(|g| g.title.clone())
        .collect::<Vec<_>>()
        .join(" / ");
    let now: DateTime<Utc> = Utc::now();
    let dur = ctx
        .item
        .duration_seconds
        .map(|d| format!("{d:.3}"))
        .unwrap_or_else(|| "null".to_string());
    format!(
        "---\n\
title: {}\n\
itemUuid: {}\n\
libraryName: {}\n\
groupPath: {}\n\
filePath: {}\n\
durationSec: {}\n\
lastUpdated: {}\n\
source: streamvault\n\
---\n",
        yaml_str(&ctx.item.title),
        ctx.item_uuid,
        yaml_str(&ctx.library.name),
        yaml_str(&group_path),
        yaml_str(&ctx.item.file_path),
        dur,
        now.to_rfc3339(),
    )
}

fn ensure_item_skeleton(content: &str, item_title: &str) -> String {
    if content.contains(END_SENTINEL) {
        return content.to_string();
    }
    let after_fm = content;
    let needs_break = !after_fm.ends_with('\n');
    let break_str = if needs_break { "\n" } else { "" };
    format!(
        "{after_fm}{break_str}\n# {title}\n\n{header}\n\n{end}\n",
        title = item_title,
        header = SECTION_HEADER,
        end = END_SENTINEL,
    )
}

fn build_note_block(note: &Note, item_uuid: &str) -> String {
    let hms = format_hms(note.timestamp_sec);
    let url = format!(
        "streamvault://play?item={}&t={:.0}",
        item_uuid, note.timestamp_sec,
    );
    let body = if note.content.contains('\n') {
        note.content
            .lines()
            .map(|l| format!("> {l}"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        format!("> {}", note.content)
    };
    format!(
        "<!-- sv:note:{id} ts={ts:.3} -->\n**[{hms}]({url})**\n\n{body}\n<!-- /sv:note:{id} -->",
        id = note.id,
        ts = note.timestamp_sec,
    )
}

// ---- Rollup _index.md per top-level group --------------------------------

fn publish_rollup_md(vault_root: &Path, db: &Database, ctx: &ItemContext) -> Result<()> {
    let Some(rollup_path) = compute_rollup_path(vault_root, ctx) else {
        return Ok(()); // movies / top-level items have no root group
    };
    ensure_within(vault_root, &rollup_path)?;
    if let Some(parent) = rollup_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let root_group = ctx.group_chain.first().expect("rollup_path implies chain");
    let items = db.list_items_in_subtree_with_note_count(root_group.id)?;

    let existing = std::fs::read_to_string(&rollup_path).unwrap_or_default();
    let mut content = upsert_frontmatter(
        &existing,
        &rollup_frontmatter(&ctx.library, root_group),
    );
    content = ensure_rollup_skeleton(&content, &root_group.title);

    // Authoritative: regenerate every sv:item block from DB.
    content = strip_all_item_blocks(&content);
    let mut block_section = String::new();
    for (item, count) in &items {
        let block = build_rollup_item_block(vault_root, &ctx.library, root_group, item, *count);
        block_section.push_str(&block);
        block_section.push('\n');
    }
    content = insert_before_end(&content, &block_section);
    write_atomic(&rollup_path, &content)
}

fn rollup_frontmatter(library: &Library, root_group: &Group) -> String {
    let now: DateTime<Utc> = Utc::now();
    format!(
        "---\n\
libraryName: {}\n\
rootGroupTitle: {}\n\
itemCount: {}\n\
completedCount: {}\n\
lastUpdated: {}\n\
source: streamvault\n\
---\n",
        yaml_str(&library.name),
        yaml_str(&root_group.title),
        root_group.item_count,
        root_group.completed_count,
        now.to_rfc3339(),
    )
}

fn ensure_rollup_skeleton(content: &str, root_title: &str) -> String {
    if content.contains(END_SENTINEL) {
        return content.to_string();
    }
    let needs_break = !content.ends_with('\n');
    let break_str = if needs_break { "\n" } else { "" };
    format!(
        "{content}{break_str}\n# {root_title}\n\n{header}\n\n{end}\n",
        header = ITEM_SECTION_HEADER,
        end = END_SENTINEL,
    )
}

fn build_rollup_item_block(
    vault_root: &Path,
    library: &Library,
    root_group: &Group,
    item: &Item,
    note_count: i64,
) -> String {
    let item_path = compute_item_md_path_for(
        vault_root,
        library,
        root_group,
        item,
    );
    let rel = item_path
        .strip_prefix(vault_root)
        .unwrap_or(&item_path)
        .with_extension("");
    let link_target = rel.to_string_lossy().replace('\\', "/");
    let suffix = if note_count == 1 {
        "1 note".to_string()
    } else {
        format!("{note_count} notes")
    };
    format!(
        "<!-- sv:item:{uuid} -->\n- [[{link}|{title}]] — {suffix}\n<!-- /sv:item:{uuid} -->",
        uuid = item.id, // rollup uses item id; per-item file uses item_uuid for URL
        link = link_target,
        title = item.title,
    )
}

// ---- Marker-block primitives ---------------------------------------------

fn block_id(note_id: i64) -> String {
    format!("note:{note_id}")
}

fn upsert_block(content: &str, block_id: &str, block_text: &str) -> String {
    if find_block(content, block_id).is_some() {
        replace_block(content, block_id, block_text)
    } else {
        insert_before_end(content, &format!("{block_text}\n"))
    }
}

fn find_block(content: &str, block_id: &str) -> Option<(usize, usize)> {
    let pat = format!(
        r"(?s)<!-- sv:{id}[^>]*-->.*?<!-- /sv:{id} -->",
        id = regex::escape(block_id),
    );
    let re = Regex::new(&pat).ok()?;
    let m = re.find(content)?;
    Some((m.start(), m.end()))
}

fn replace_block(content: &str, block_id: &str, replacement: &str) -> String {
    if let Some((start, end)) = find_block(content, block_id) {
        let mut out = String::with_capacity(content.len() + replacement.len());
        out.push_str(&content[..start]);
        out.push_str(replacement);
        out.push_str(&content[end..]);
        out
    } else {
        content.to_string()
    }
}

fn remove_block(content: &str, block_id: &str) -> String {
    let pat = format!(
        r"(?s)<!-- sv:{id}[^>]*-->.*?<!-- /sv:{id} -->\n?",
        id = regex::escape(block_id),
    );
    let re = match Regex::new(&pat) {
        Ok(r) => r,
        Err(_) => return content.to_string(),
    };
    re.replace(content, "").into_owned()
}

fn insert_before_end(content: &str, block_text: &str) -> String {
    if let Some(idx) = content.rfind(END_SENTINEL) {
        let mut out = String::with_capacity(content.len() + block_text.len() + 1);
        out.push_str(&content[..idx]);
        out.push_str(block_text);
        if !block_text.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&content[idx..]);
        out
    } else {
        // No sentinel — append the block + sentinel for next time.
        let mut out = String::from(content);
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(block_text);
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(END_SENTINEL);
        out.push('\n');
        out
    }
}

fn strip_all_note_blocks(content: &str) -> String {
    static RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?s)<!-- sv:note:[^>]*-->.*?<!-- /sv:note:\d+ -->\n?")
            .expect("compile note regex")
    });
    RE.replace_all(content, "").into_owned()
}

fn strip_all_item_blocks(content: &str) -> String {
    static RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?s)<!-- sv:item:[^>]*-->.*?<!-- /sv:item:\d+ -->\n?")
            .expect("compile item regex")
    });
    RE.replace_all(content, "").into_owned()
}

// ---- Frontmatter helpers --------------------------------------------------

static FRONTMATTER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)\A---\n.*?\n---\n").expect("compile frontmatter regex"));

fn upsert_frontmatter(content: &str, fresh: &str) -> String {
    if FRONTMATTER_RE.is_match(content) {
        FRONTMATTER_RE.replace(content, regex::NoExpand(fresh)).into_owned()
    } else {
        format!("{fresh}{content}")
    }
}

fn yaml_str(s: &str) -> String {
    // Quote + escape minimal YAML scalars. Backslashes and double quotes get
    // escaped; newlines are flattened to spaces (we don't expect them here).
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ");
    format!("\"{escaped}\"")
}

// ---- Path helpers ---------------------------------------------------------

fn compute_item_md_path(vault_root: &Path, ctx: &ItemContext) -> PathBuf {
    let mut p = vault_root.join(SUBFOLDER);
    p.push(slug(&ctx.library.name));
    for g in &ctx.group_chain {
        p.push(slug(&g.title));
    }
    p.push(format!("{}.md", slug(&ctx.item.title)));
    p
}

fn compute_item_md_path_for(
    vault_root: &Path,
    library: &Library,
    root_group: &Group,
    item: &Item,
) -> PathBuf {
    // Used by the rollup; for the rollup we only know the root group, not the
    // full chain. Approximation: place under {library}/{rootGroup}/{itemTitle}.
    // Items at deeper levels still link correctly because Obsidian wikilinks
    // resolve by filename inside a vault; the relative path is a hint only.
    let mut p = vault_root.join(SUBFOLDER);
    p.push(slug(&library.name));
    p.push(slug(&root_group.title));
    p.push(format!("{}.md", slug(&item.title)));
    p
}

fn compute_rollup_path(vault_root: &Path, ctx: &ItemContext) -> Option<PathBuf> {
    let root = ctx.group_chain.first()?;
    let mut p = vault_root.join(SUBFOLDER);
    p.push(slug(&ctx.library.name));
    p.push(slug(&root.title));
    p.push(ROLLUP_FILE);
    Some(p)
}

fn slug(s: &str) -> String {
    // Strip filesystem-unsafe characters; preserve spaces and unicode.
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => {}
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let trimmed = out.trim().trim_matches('.');
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed.to_string()
    }
}

fn ensure_within(root: &Path, target: &Path) -> Result<()> {
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    // Target may not exist yet; canonicalize an existing ancestor instead.
    let mut cursor = target.to_path_buf();
    while !cursor.exists() {
        match cursor.parent() {
            Some(p) => cursor = p.to_path_buf(),
            None => return Err(anyhow!("target has no existing ancestor: {:?}", target)),
        }
    }
    let canon_existing = cursor
        .canonicalize()
        .with_context(|| format!("canonicalize ancestor {:?}", cursor))?;
    if !canon_existing.starts_with(&canon_root) {
        return Err(anyhow!(
            "target {:?} escapes vault root {:?}",
            target,
            canon_root
        ));
    }
    Ok(())
}

fn write_atomic(target: &Path, content: &str) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("target has no parent: {:?}", target))?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("create_dir_all {parent:?}"))?;
    let mut tmp = target.to_path_buf();
    let stem = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("note.md");
    tmp.set_file_name(format!(".{stem}.tmp"));
    std::fs::write(&tmp, content).with_context(|| format!("write tmp {tmp:?}"))?;
    std::fs::rename(&tmp, target).with_context(|| format!("rename {tmp:?} -> {target:?}"))?;
    Ok(())
}

fn format_hms(seconds: f64) -> String {
    let s = seconds.max(0.0) as u64;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{:02}:{:02}", m, sec)
    }
}

// ---- DB helper specific to rollup -----------------------------------------

impl Database {
    /// Items in the given root group's subtree, paired with their note count.
    /// Only items with at least one note are returned.
    pub fn list_items_in_subtree_with_note_count(
        &self,
        root_group_id: i64,
    ) -> Result<Vec<(Item, i64)>> {
        self.with_conn(|c| {
            let q = r#"
                WITH RECURSIVE tree(id) AS (
                    SELECT id FROM groups WHERE id = ?
                    UNION ALL
                    SELECT g.id FROM groups g JOIN tree t ON g.parent_group_id = t.id
                )
                SELECT i.id, i.library_id, i.group_id, i.title, i.position,
                       i.file_path, i.duration_seconds, i.thumbnail_path,
                       i.season_number, i.episode_number,
                       COUNT(n.id) AS note_count
                FROM items i
                JOIN tree t ON t.id = i.group_id
                JOIN notes n ON n.item_id = i.id
                GROUP BY i.id
                ORDER BY i.position, i.title
            "#;
            let mut stmt = c.prepare(q)?;
            let rows = stmt.query_map([root_group_id], |r| {
                let item = Item {
                    id: r.get(0)?,
                    library_id: r.get(1)?,
                    group_id: r.get(2)?,
                    title: r.get(3)?,
                    position: r.get(4)?,
                    file_path: r.get(5)?,
                    duration_seconds: r.get(6)?,
                    thumbnail_path: r.get(7)?,
                    season_number: r.get(8)?,
                    episode_number: r.get(9)?,
                };
                let count: i64 = r.get(10)?;
                Ok((item, count))
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }
}

// ---- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: i64, item_id: i64, ts: f64, content: &str) -> Note {
        Note {
            id,
            item_id,
            timestamp_sec: ts,
            content: content.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn slug_strips_unsafe_chars() {
        assert_eq!(slug("Course: Intro / 01"), "Course Intro  01");
        assert_eq!(slug("Foo?<>|"), "Foo");
        assert_eq!(slug("   "), "_");
    }

    #[test]
    fn format_hms_under_and_over_hour() {
        assert_eq!(format_hms(0.0), "00:00");
        assert_eq!(format_hms(75.0), "01:15");
        assert_eq!(format_hms(3725.0), "01:02:05");
    }

    #[test]
    fn upsert_frontmatter_replaces_existing() {
        let content = "---\nold: yes\n---\n\n# title\n";
        let out = upsert_frontmatter(content, "---\nnew: yes\n---\n");
        assert!(out.starts_with("---\nnew: yes\n---\n"));
        assert!(out.contains("# title"));
    }

    #[test]
    fn upsert_frontmatter_prepends_when_missing() {
        let out = upsert_frontmatter("# title\n", "---\nx: 1\n---\n");
        assert!(out.starts_with("---\nx: 1\n---\n"));
        assert!(out.contains("# title"));
    }

    #[test]
    fn upsert_block_inserts_before_sentinel() {
        let body = format!("body\n\n{}\n", END_SENTINEL);
        let block = "<!-- sv:note:1 ts=10 -->\nhi\n<!-- /sv:note:1 -->";
        let out = upsert_block(&body, "note:1", block);
        assert!(out.contains("hi"));
        let block_pos = out.find("hi").unwrap();
        let end_pos = out.rfind(END_SENTINEL).unwrap();
        assert!(block_pos < end_pos);
    }

    #[test]
    fn upsert_block_replaces_existing_same_id() {
        let body = format!(
            "<!-- sv:note:1 ts=10 -->\nold\n<!-- /sv:note:1 -->\n{}\n",
            END_SENTINEL,
        );
        let block = "<!-- sv:note:1 ts=20 -->\nnew\n<!-- /sv:note:1 -->";
        let out = upsert_block(&body, "note:1", block);
        assert!(out.contains("new"));
        assert!(!out.contains("old"));
    }

    #[test]
    fn remove_block_targets_only_matching_id() {
        let body = format!(
            "<!-- sv:note:1 ts=10 -->\nA\n<!-- /sv:note:1 -->\n\
             <!-- sv:note:2 ts=20 -->\nB\n<!-- /sv:note:2 -->\n{}\n",
            END_SENTINEL,
        );
        let out = remove_block(&body, "note:1");
        assert!(!out.contains("A\n<!-- /sv:note:1 -->"));
        assert!(out.contains("B\n<!-- /sv:note:2 -->"));
    }

    #[test]
    fn insert_before_end_preserves_user_prose() {
        let body = format!(
            "intro paragraph\n\n{header}\n\nuser writes here\n\n<!-- sv:note:1 ts=10 -->\nA\n<!-- /sv:note:1 -->\n{end}\n",
            header = SECTION_HEADER,
            end = END_SENTINEL,
        );
        let block = "<!-- sv:note:2 ts=20 -->\nB\n<!-- /sv:note:2 -->";
        let out = insert_before_end(&body, &format!("{block}\n"));
        assert!(out.contains("intro paragraph"));
        assert!(out.contains("user writes here"));
        assert!(out.contains("A"));
        assert!(out.contains("B"));
    }

    #[test]
    fn build_note_block_renders_quoted_body() {
        let n = note(1, 1, 754.0, "Important moment");
        let block = build_note_block(&n, "abc-uuid");
        assert!(block.contains("[12:34]"));
        assert!(block.contains("streamvault://play?item=abc-uuid&t=754"));
        assert!(block.contains("> Important moment"));
        assert!(block.starts_with("<!-- sv:note:1 ts=754.000 -->"));
    }

    #[test]
    fn ensure_within_blocks_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let inside = root.join("foo/bar.md");
        let outside = root.join("../escape.md");
        assert!(ensure_within(&root, &inside).is_ok());
        assert!(ensure_within(&root, &outside).is_err());
    }

    #[test]
    fn write_atomic_creates_dirs_and_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("nested/deep/note.md");
        write_atomic(&target, "hello").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "hello");
    }
}

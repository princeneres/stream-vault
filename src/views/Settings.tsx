import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  BookOpen,
  Folder,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import Button from "@/components/Button";
import { useConfirm } from "@/components/ConfirmDialog";
import IconButton from "@/components/IconButton";
import Input from "@/components/Input";
import KindIcon from "@/components/KindIcon";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { useToast } from "@/components/Toast";
import {
  addLibrary,
  getSetting,
  listLibraries,
  removeLibrary,
  republishVault,
  scanLibrary,
  setSetting,
} from "@/lib/api";
import type { Library, LibraryKind, ScanResult } from "@/lib/types";

const KIND_OPTIONS: { value: LibraryKind; label: string }[] = [
  { value: "courses", label: "Courses" },
  { value: "series", label: "Series" },
  { value: "movies", label: "Movies" },
  { value: "generic", label: "Generic" },
];

export interface SettingsProps {
  /** Bumped when libraries are added/removed/scanned, so the App can refresh. */
  onLibrariesChanged: () => void;
}

export default function Settings({ onLibrariesChanged }: SettingsProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [vaultPath, setVaultPath] = useState("");
  const [vaultSubfolder, setVaultSubfolder] = useState("");
  const [savedSubfolder, setSavedSubfolder] = useState("");
  const [republishing, setRepublishing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const { push: pushToast } = useToast();
  const confirm = useConfirm();

  const refreshLibraries = async () => {
    try {
      const libs = await listLibraries();
      setLibraries(libs);
    } catch (e) {
      console.error("listLibraries failed", e);
    }
  };

  useEffect(() => {
    refreshLibraries();
    (async () => {
      try {
        const v = await getSetting("auto_advance");
        setAutoAdvance(v === "true");
      } catch (e) {
        console.error("getSetting failed", e);
      }
    })();
    (async () => {
      try {
        const v = await getSetting("obsidian_vault_path");
        setVaultPath(v ?? "");
      } catch (e) {
        console.error("getSetting failed", e);
      }
    })();
    (async () => {
      try {
        const v = await getSetting("obsidian_vault_subfolder");
        setVaultSubfolder(v ?? "");
        setSavedSubfolder(v ?? "");
      } catch (e) {
        console.error("getSetting failed", e);
      }
    })();
  }, []);

  const handleScan = async (lib: Library) => {
    setScanningId(lib.id);
    try {
      const result: ScanResult = await scanLibrary(lib.id);
      pushToast(
        `Scanned "${lib.name}": +${result.itemsAdded} items, -${result.itemsRemoved}, ~${result.itemsUpdated} updated`,
        "success",
      );
      await refreshLibraries();
      onLibrariesChanged();
    } catch (e) {
      pushToast(`Scan failed: ${String(e)}`, "error");
    } finally {
      setScanningId(null);
    }
  };

  const handleRemove = async (lib: Library) => {
    const ok = await confirm({
      title: "Remove library",
      message: `Remove library "${lib.name}"? This cannot be undone.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removeLibrary(lib.id);
      pushToast(`Removed "${lib.name}"`, "success");
      await refreshLibraries();
      onLibrariesChanged();
    } catch (e) {
      pushToast(`Remove failed: ${String(e)}`, "error");
    }
  };

  const handleAutoAdvance = async (next: boolean) => {
    setAutoAdvance(next);
    try {
      await setSetting("auto_advance", next ? "true" : "false");
    } catch (e) {
      pushToast(`Failed to save: ${String(e)}`, "error");
    }
  };

  const handlePickVault = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      setVaultPath(selected);
      await setSetting("obsidian_vault_path", selected);
      pushToast("Obsidian vault path saved", "success");
    } catch (e) {
      pushToast(`Failed to set vault path: ${String(e)}`, "error");
    }
  };

  const handleClearVault = async () => {
    setVaultPath("");
    try {
      await setSetting("obsidian_vault_path", "");
      pushToast("Obsidian vault disabled", "info");
    } catch (e) {
      pushToast(`Failed to clear: ${String(e)}`, "error");
    }
  };

  const handleSaveSubfolder = async () => {
    const trimmed = vaultSubfolder.trim();
    if (trimmed === savedSubfolder.trim()) return;
    try {
      await setSetting("obsidian_vault_subfolder", trimmed);
      setSavedSubfolder(trimmed);
      pushToast(
        "Subfolder saved. Republish to relocate notes.",
        "info",
      );
    } catch (e) {
      pushToast(`Failed to save subfolder: ${String(e)}`, "error");
    }
  };

  const handleRepublishVault = async () => {
    if (!vaultPath) return;
    setRepublishing(true);
    try {
      const count = await republishVault();
      pushToast(
        `Republished ${count} item${count === 1 ? "" : "s"} to vault`,
        "success",
      );
    } catch (e) {
      pushToast(`Republish failed: ${String(e)}`, "error");
    } finally {
      setRepublishing(false);
    }
  };

  return (
    <div className="space-y-10 px-8 py-6">
      <header>
        <h1 className="text-2xl font-semibold text-(--color-text-primary)">
          Settings
        </h1>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-(--color-text-primary)">
            Libraries
          </h2>
          <Button
            variant="primary"
            leadingIcon={<Plus size={14} />}
            onClick={() => setAddOpen(true)}
          >
            Add library
          </Button>
        </div>
        {libraries.length === 0 ? (
          <p className="text-sm text-(--color-text-secondary)">
            No libraries configured.
          </p>
        ) : (
          <ul className="space-y-2">
            {libraries.map((lib) => (
              <li
                key={lib.id}
                className="flex items-center gap-4 rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface) px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-pill) bg-(--color-surface-raised) text-(--color-text-secondary)">
                  <KindIcon kind={lib.kind} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-(--color-text-primary)">
                      {lib.name}
                    </p>
                    {!lib.available ? (
                      <span className="inline-flex items-center gap-1 rounded-(--radius-pill) bg-(--color-surface-raised) px-2 py-0.5 text-[11px] text-(--color-warning)">
                        <AlertTriangle size={10} />
                        Unavailable
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-(--color-text-secondary)">
                    {lib.rootPath}
                  </p>
                  <p className="text-xs text-(--color-text-muted)">
                    {lib.lastScannedAt
                      ? `Last scanned ${new Date(lib.lastScannedAt).toLocaleString()}`
                      : "Never scanned"}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<RefreshCw size={12} />}
                  onClick={() => handleScan(lib)}
                  disabled={scanningId === lib.id}
                >
                  {scanningId === lib.id ? "Scanning…" : "Rescan"}
                </Button>
                <IconButton
                  icon={<Trash2 size={14} />}
                  tooltip="Remove"
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemove(lib)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-(--color-text-primary)">
          Playback
        </h2>
        <div className="flex items-center justify-between gap-4 rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface) px-4 py-3">
          <div className="space-y-0.5">
            <p
              id="auto-advance-label"
              className="text-sm font-medium text-(--color-text-primary)"
            >
              Auto-advance
            </p>
            <p
              id="auto-advance-desc"
              className="text-xs text-(--color-text-secondary)"
            >
              Play the next item automatically when one finishes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoAdvance}
            aria-labelledby="auto-advance-label"
            aria-describedby="auto-advance-desc"
            onClick={() => handleAutoAdvance(!autoAdvance)}
            className={
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-(--radius-pill) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-bg) " +
              (autoAdvance
                ? "bg-(--color-accent)"
                : "bg-(--color-surface-hover)")
            }
          >
            <span
              aria-hidden
              className={
                "inline-block h-3.5 w-3.5 transform rounded-(--radius-pill) bg-(--color-text-primary) transition-transform " +
                (autoAdvance ? "translate-x-5" : "translate-x-1")
              }
            />
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-(--color-text-primary)">
          Notes & Obsidian
        </h2>
        <div className="space-y-3 rounded-(--radius-card) border border-(--color-border-subtle) bg-(--color-surface) px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-pill) bg-(--color-surface-raised) text-(--color-text-secondary)">
              <BookOpen size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium text-(--color-text-primary)">
                Obsidian vault
              </p>
              <p className="text-xs text-(--color-text-secondary)">
                Each note is mirrored as Markdown under{" "}
                <code className="rounded bg-(--color-surface-raised) px-1 py-0.5 text-[11px]">
                  {(savedSubfolder.trim() || "StreamVault") + "/"}
                </code>{" "}
                inside the chosen vault. Leave empty to keep notes local-only.
              </p>
              {vaultPath ? (
                <p className="truncate text-xs text-(--color-text-muted)">
                  {vaultPath}
                </p>
              ) : (
                <p className="text-xs text-(--color-text-muted)">
                  Not configured.
                </p>
              )}
            </div>
          </div>
          {vaultPath ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-(--color-text-secondary)">
                Subfolder name
              </span>
              <Input
                value={vaultSubfolder}
                onChange={(e) => setVaultSubfolder(e.currentTarget.value)}
                onBlur={handleSaveSubfolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                placeholder="StreamVault"
              />
              <span className="text-[11px] text-(--color-text-muted)">
                Unsafe characters (/ \ : * ? &quot; &lt; &gt; |) are stripped.
                Empty falls back to <code>StreamVault</code>. After changing,
                use <em>Republish all notes</em> to write to the new folder
                (the old folder is left in place).
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Folder size={14} />}
              onClick={handlePickVault}
            >
              {vaultPath ? "Change folder" : "Choose folder"}
            </Button>
            {vaultPath ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Upload size={14} />}
                onClick={handleRepublishVault}
                disabled={republishing}
              >
                {republishing ? "Republishing…" : "Republish all notes"}
              </Button>
            ) : null}
            {vaultPath ? (
              <Button variant="ghost" size="sm" onClick={handleClearVault}>
                Disable
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <AddLibraryModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={async (lib) => {
          pushToast(`Added "${lib.name}"`, "success");
          await refreshLibraries();
          onLibrariesChanged();
        }}
        onError={(e) => pushToast(`Add failed: ${e}`, "error")}
      />
    </div>
  );
}

interface AddLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (lib: Library) => void;
  onError: (message: string) => void;
}

function AddLibraryModal({ open, onClose, onAdded, onError }: AddLibraryModalProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<LibraryKind>("courses");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setPath("");
      setKind("courses");
      setSubmitting(false);
    }
  }, [open]);

  const handlePickFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setPath(selected);
        if (!name) {
          const parts = selected.split(/[/\\]/).filter(Boolean);
          if (parts.length) setName(parts[parts.length - 1]);
        }
      }
    } catch (e) {
      onError(`Folder picker failed: ${String(e)}`);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !path.trim()) return;
    setSubmitting(true);
    try {
      const lib = await addLibrary(name.trim(), path.trim(), kind);
      onAdded(lib);
      onClose();
    } catch (e) {
      onError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add library">
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-(--color-text-secondary)">
            Name
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="My Courses"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-(--color-text-secondary)">
            Kind
          </span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as LibraryKind)}
            options={KIND_OPTIONS}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-(--color-text-secondary)">
            Folder
          </span>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.currentTarget.value)}
              placeholder="/path/to/folder"
              className="flex-1"
            />
            <Button
              variant="secondary"
              leadingIcon={<Folder size={14} />}
              onClick={handlePickFolder}
              type="button"
            >
              Browse
            </Button>
          </div>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !path.trim()}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Pencil, Play, StickyNote, Trash2 } from "lucide-react";
import Button from "./Button";
import IconButton from "./IconButton";
import { useToast } from "./Toast";
import { cn } from "./cn";
import { deleteNote, listNotesForItem, updateNote } from "@/lib/api";
import { usePlayer } from "@/lib/player";
import type { Note } from "@/lib/types";

export interface NotesPanelProps {
  itemId: number;
  /** Bumped from App when `note-saved` fires; refetches. */
  refreshTick: number;
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function NotesPanel({ itemId, refreshTick }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();
  const { play, controlsRef } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listNotesForItem(itemId);
        if (!cancelled) setNotes(result);
      } catch (e) {
        console.error("listNotesForItem failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, refreshTick]);

  const handleSeek = useCallback(
    (note: Note) => {
      const controls = controlsRef.current;
      if (controls && controls.itemId === note.itemId) {
        controls.seek(note.timestampSec);
      } else {
        play(note.itemId, note.timestampSec);
      }
    },
    [play, controlsRef],
  );

  const handleEditStart = (note: Note) => {
    setEditingId(note.id);
    setDraft(note.content);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setDraft("");
  };

  const handleEditSave = async (id: number) => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusyId(id);
    try {
      await updateNote(id, trimmed);
      setEditingId(null);
      setDraft("");
    } catch (e) {
      console.error("updateNote failed", e);
      toast.push("Could not save note", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyId(id);
    try {
      await deleteNote(id);
    } catch (e) {
      console.error("deleteNote failed", e);
      toast.push("Could not delete note", "error");
    } finally {
      setBusyId(null);
    }
  };

  if (notes == null) {
    return (
      <p className="text-sm text-(--color-text-muted)">Loading notes…</p>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-(--color-text-muted)">
        <StickyNote size={14} aria-hidden />
        <span>No notes yet — press Alt + N during playback.</span>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {notes.map((note) => {
        const isEditing = editingId === note.id;
        const busy = busyId === note.id;
        return (
          <li
            key={note.id}
            className="flex items-start gap-3 rounded-(--radius-control) bg-(--color-surface-raised) px-3 py-2"
          >
            <button
              type="button"
              onClick={() => handleSeek(note)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-(--radius-pill) bg-(--color-accent-soft) px-2 py-1",
                "text-xs font-medium text-(--color-accent) hover:bg-(--color-accent) hover:text-(--color-text-inverse)",
                "tabular-nums",
              )}
              aria-label={`Play from ${formatTimestamp(note.timestampSec)}`}
            >
              <Play size={11} aria-hidden />
              {formatTimestamp(note.timestampSec)}
            </button>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    rows={3}
                    className="w-full resize-y rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface) px-2 py-1.5 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent)"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEditCancel}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleEditSave(note.id)}
                      disabled={busy || draft.trim().length === 0}
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-(--color-text-primary)">
                  {note.content}
                </p>
              )}
            </div>
            {!isEditing ? (
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  icon={<Pencil size={12} />}
                  tooltip="Edit note"
                  size="sm"
                  onClick={() => handleEditStart(note)}
                  disabled={busy}
                />
                <IconButton
                  icon={<Trash2 size={12} />}
                  tooltip="Delete note"
                  size="sm"
                  onClick={() => handleDelete(note.id)}
                  disabled={busy}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

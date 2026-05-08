import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { addNote } from "@/lib/api";

export interface NoteCaptureContext {
  itemId: number;
  timestampSec: number;
}

export interface NoteCaptureModalProps {
  context: NoteCaptureContext | null;
  onClose: () => void;
}

function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function NoteCaptureModal({
  context,
  onClose,
}: NoteCaptureModalProps) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (context) {
      setContent("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [context]);

  if (!context) return null;

  const handleSave = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await addNote(context.itemId, context.timestampSec, trimmed);
      toast.push(`Note saved at ${formatTimestamp(context.timestampSec)}`);
      onClose();
    } catch (e) {
      console.error("addNote failed", e);
      toast.push("Could not save note", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Note at ${formatTimestamp(context.timestampSec)}`}
    >
      <div className="space-y-4">
        <p className="text-xs text-(--color-text-muted)">
          Video paused. Esc cancels, Cmd/Ctrl + Enter saves.
        </p>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          onKeyDown={handleKey}
          placeholder="What's important here?"
          rows={5}
          className="w-full resize-y rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface-raised) px-3 py-2 text-sm text-(--color-text-primary) outline-none focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent-soft)"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || content.trim().length === 0}
          >
            {saving ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import IconButton from "./IconButton";
import { cn } from "./cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Modal({ open, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling within the dialog.
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can return it when the dialog closes,
    // keeping keyboard users where they left off.
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => trigger?.focus?.();
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="motion-safe:animate-overlay-in fixed inset-0 z-(--z-modal) flex items-center justify-center bg-(--color-overlay) p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "motion-safe:animate-dialog-in w-full max-w-md rounded-(--radius-card-lg) bg-(--color-surface) shadow-(--shadow-modal) outline-none",
          "border border-(--color-border-subtle)",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-(--color-border-subtle) px-5 py-3">
          <h2 className="text-base font-semibold text-(--color-text-primary)">
            {title ?? ""}
          </h2>
          <IconButton
            icon={<X size={16} />}
            tooltip="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

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
      if (e.key === "Escape") onClose();
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
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-(--color-overlay) p-4"
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
          "w-full max-w-md rounded-(--radius-card-lg) bg-(--color-surface) shadow-(--shadow-modal) outline-none",
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

import Modal from "./Modal";

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  keys: string[];
  label: string;
}

const SHORTCUTS: { section: string; rows: Row[] }[] = [
  {
    section: "General",
    rows: [
      { keys: ["/"], label: "Open search" },
      { keys: ["Ctrl", "K"], label: "Open search" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close dialogs / back to home" },
    ],
  },
  {
    section: "Navigation",
    rows: [
      { keys: ["g", "h"], label: "Go to home" },
      { keys: ["g", "s"], label: "Go to settings" },
    ],
  },
  {
    section: "Playback",
    rows: [{ keys: ["Alt", "N"], label: "Capture note at current timestamp" }],
  },
];

export default function ShortcutsDialog({
  open,
  onClose,
}: ShortcutsDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-5">
        {SHORTCUTS.map((group) => (
          <div key={group.section} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
              {group.section}
            </p>
            <ul className="space-y-1.5">
              {group.rows.map((row) => (
                <li
                  key={row.label + row.keys.join("+")}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-sm text-(--color-text-secondary)">
                    {row.label}
                  </span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <kbd className="rounded bg-(--color-bg) px-1.5 py-0.5 text-[11px] font-medium text-(--color-text-primary) shadow-(--shadow-card)">
                          {k}
                        </kbd>
                        {i < row.keys.length - 1 ? (
                          <span className="text-[11px] text-(--color-text-muted)">
                            then
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

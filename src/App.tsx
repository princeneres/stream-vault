import { useCallback, useEffect, useState } from "react";
import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import CommandPalette from "@/components/CommandPalette";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import KindIcon from "@/components/KindIcon";
import NoteCaptureModal, {
  type NoteCaptureContext,
} from "@/components/NoteCaptureModal";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import Sidebar, { type SidebarItem } from "@/components/Sidebar";
import { ToastProvider, useToast } from "@/components/Toast";
import {
  listLibraries,
  mpvCurrentItemId,
  mpvGetPosition,
  mpvSetPaused,
  onItemProgress,
  onNoteSaved,
} from "@/lib/api";
import { type Route, useRoute } from "@/lib/router";
import type { Library, NoteSavedEvent } from "@/lib/types";
import DetailView from "@/views/DetailView";
import Home from "@/views/Home";
import LibraryView from "@/views/LibraryView";
import Settings from "@/views/Settings";

export default function App() {
  const [view, setView] = useRoute();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [progressTick, setProgressTick] = useState(0);
  const [notesTick, setNotesTick] = useState(0);

  const refreshLibraries = useCallback(async () => {
    try {
      const libs = await listLibraries();
      setLibraries(libs);
    } catch (e) {
      console.error("listLibraries failed", e);
    }
  }, []);

  useEffect(() => {
    refreshLibraries();
  }, [refreshLibraries]);

  useEffect(() => {
    const unlisten: Array<() => void> = [];
    let cancelled = false;
    const bump = () => setProgressTick((t) => t + 1);
    const bumpNotes = (_e: NoteSavedEvent) => setNotesTick((t) => t + 1);

    // Coalesce `library-artwork` bursts: the backend emits roughly every 8
    // generated thumbnails during a scan, which would otherwise refetch every
    // open view in lockstep and stutter scroll. One refresh per second is
    // enough for progressive artwork to land.
    let artworkTimer: ReturnType<typeof setTimeout> | null = null;
    const artworkBump = () => {
      if (artworkTimer) return;
      artworkTimer = setTimeout(() => {
        artworkTimer = null;
        bump();
      }, 1000);
    };

    onItemProgress(bump)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten.push(fn);
      })
      .catch((e) => console.error("onItemProgress subscribe failed", e));

    onNoteSaved(bumpNotes)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten.push(fn);
      })
      .catch((e) => console.error("onNoteSaved subscribe failed", e));

    listen("library-artwork", artworkBump)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten.push(fn);
      })
      .catch((e) => console.error("library-artwork subscribe failed", e));

    return () => {
      cancelled = true;
      if (artworkTimer) clearTimeout(artworkTimer);
      for (const fn of unlisten) fn();
    };
  }, []);

  const sidebarItems: SidebarItem[] = [
    { id: "home", label: "Home", icon: <HomeIcon size={14} /> },
    ...libraries.map((lib) => ({
      id: `library:${lib.id}`,
      label: lib.name,
      icon: <KindIcon kind={lib.kind} size={14} />,
    })),
    { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
  ];

  const activeId =
    view.kind === "home"
      ? "home"
      : view.kind === "settings"
        ? "settings"
        : view.kind === "library"
          ? `library:${view.id}`
          : null;

  const handleSelect = (id: string) => {
    if (id === "home") setView({ kind: "home" });
    else if (id === "settings") setView({ kind: "settings" });
    else if (id.startsWith("library:")) {
      const libId = Number(id.slice("library:".length));
      if (!Number.isNaN(libId)) setView({ kind: "library", id: libId });
    }
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          sidebarItems={sidebarItems}
          activeId={activeId}
          onSelect={handleSelect}
          view={view}
          libraries={libraries}
          progressTick={progressTick}
          notesTick={notesTick}
          setView={setView}
          refreshLibraries={refreshLibraries}
        />
      </ConfirmProvider>
    </ToastProvider>
  );
}

interface AppShellProps {
  sidebarItems: SidebarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  view: Route;
  libraries: Library[];
  progressTick: number;
  notesTick: number;
  setView: (v: Route) => void;
  refreshLibraries: () => Promise<void>;
}

function AppShell({
  sidebarItems,
  activeId,
  onSelect,
  view,
  libraries,
  progressTick,
  notesTick,
  setView,
  refreshLibraries,
}: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [captureCtx, setCaptureCtx] = useState<NoteCaptureContext | null>(null);
  const toast = useToast();

  const triggerNoteCapture = useCallback(async () => {
    try {
      const itemId = await mpvCurrentItemId();
      if (itemId == null) {
        toast.push("Start playing a video to capture a note", "info");
        return;
      }
      const pos = (await mpvGetPosition()) ?? 0;
      mpvSetPaused(true).catch((e) =>
        console.error("mpvSetPaused failed", e),
      );
      setCaptureCtx({ itemId, timestampSec: pos });
    } catch (e) {
      console.error("note capture trigger failed", e);
      toast.push("Could not start note capture", "error");
    }
  }, [toast]);

  const closeNoteCapture = useCallback(() => {
    setCaptureCtx(null);
    mpvSetPaused(false).catch((e) => console.error("mpvSetPaused failed", e));
  }, []);

  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | null = null;
    let chord: "g" | null = null;

    const clearChord = () => {
      chord = null;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen || shortcutsOpen || captureCtx) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setPaletteOpen(true);
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "n") {
          e.preventDefault();
          triggerNoteCapture();
        }
        return;
      }
      if (chord === "g") {
        if (e.key === "h") {
          e.preventDefault();
          setView({ kind: "home" });
        } else if (e.key === "s") {
          e.preventDefault();
          setView({ kind: "settings" });
        }
        clearChord();
        return;
      }
      if (e.key === "g") {
        chord = "g";
        chordTimer = setTimeout(clearChord, 700);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "Escape" && view.kind !== "home") {
        e.preventDefault();
        setView({ kind: "home" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [paletteOpen, shortcutsOpen, captureCtx, setView, view.kind, triggerNoteCapture]);

  return (
    <div className="flex h-screen bg-(--color-bg) text-(--color-text-primary)">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <Sidebar
        items={sidebarItems}
        activeId={activeId}
        onSelect={onSelect}
        onSearch={() => setPaletteOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenGroup={(id) => {
          setView({ kind: "group", id });
          setPaletteOpen(false);
        }}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <NoteCaptureModal context={captureCtx} onClose={closeNoteCapture} />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 overflow-y-auto outline-none"
      >
        {view.kind === "home" ? (
          <Home
            libraries={libraries}
            onOpenLibrary={(id) => setView({ kind: "library", id })}
            onOpenGroup={(id) => setView({ kind: "group", id })}
            progressTick={progressTick}
          />
        ) : view.kind === "library" ? (
          <LibraryView
            libraryId={view.id}
            onOpenGroup={(id) => setView({ kind: "group", id })}
            progressTick={progressTick}
          />
        ) : view.kind === "group" ? (
          <DetailView
            groupId={view.id}
            progressTick={progressTick}
            notesTick={notesTick}
          />
        ) : (
          <Settings onLibrariesChanged={refreshLibraries} />
        )}
      </main>
    </div>
  );
}

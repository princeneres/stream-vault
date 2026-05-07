import { useCallback, useEffect, useState } from "react";
import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import CommandPalette from "@/components/CommandPalette";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import KindIcon from "@/components/KindIcon";
import Sidebar, { type SidebarItem } from "@/components/Sidebar";
import { ToastProvider } from "@/components/Toast";
import { listLibraries, onItemProgress } from "@/lib/api";
import type { Library } from "@/lib/types";
import DetailView from "@/views/DetailView";
import Home from "@/views/Home";
import LibraryView from "@/views/LibraryView";
import Settings from "@/views/Settings";

type View =
  | { kind: "home" }
  | { kind: "library"; id: number }
  | { kind: "group"; id: number }
  | { kind: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [progressTick, setProgressTick] = useState(0);

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
  view: View;
  libraries: Library[];
  progressTick: number;
  setView: (v: View) => void;
  refreshLibraries: () => Promise<void>;
}

function AppShell({
  sidebarItems,
  activeId,
  onSelect,
  view,
  libraries,
  progressTick,
  setView,
  refreshLibraries,
}: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

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
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenGroup={(id) => {
          setView({ kind: "group", id });
          setPaletteOpen(false);
        }}
      />
      <main id="main" className="flex-1 overflow-y-auto">
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
          <DetailView groupId={view.id} progressTick={progressTick} />
        ) : (
          <Settings onLibrariesChanged={refreshLibraries} />
        )}
      </main>
    </div>
  );
}

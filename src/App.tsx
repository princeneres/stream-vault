import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import KindIcon from "@/components/KindIcon";
import {
  type NoteCaptureContext,
} from "@/components/NoteCaptureModal";
import type { PlayerRequest } from "@/components/PlayerOverlay";
import Sidebar, { type SidebarItem } from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { ToastProvider, useToast } from "@/components/Toast";
import { listLibraries, onItemProgress, onNoteSaved, scanLibrary } from "@/lib/api";
import { useBreadcrumb } from "@/lib/breadcrumb";
import { buildCommands } from "@/lib/commands";
import {
  PlayerContext,
  type PlayerContextValue,
  type PlayerControls,
} from "@/lib/player";
import { type NavHistory, useHistory } from "@/lib/router";
import {
  applyMotion,
  applyTheme,
  getStoredMotion,
} from "@/lib/theme";
import { TopBarSlotProvider } from "@/lib/topbar";
import type { Library, NoteSavedEvent } from "@/lib/types";

// Route-level code splitting: Home is the landing view and stays eager; the
// heavier screens and overlays load on demand, shrinking the initial bundle
// parsed at startup. DetailView in particular pulls in the dialog/opener
// plugins and NotesPanel only when a group is actually opened.
import Home from "@/views/Home";
const LibraryView = lazy(() => import("@/views/LibraryView"));
const DetailView = lazy(() => import("@/views/DetailView"));
const Settings = lazy(() => import("@/views/Settings"));
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const ShortcutsDialog = lazy(() => import("@/components/ShortcutsDialog"));
const NoteCaptureModal = lazy(() => import("@/components/NoteCaptureModal"));
const PlayerOverlay = lazy(() => import("@/components/PlayerOverlay"));

export default function App() {
  const history = useHistory();
  const view = history.route;
  const setView = history.navigate;
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

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      { id: "home", label: "Home", icon: <HomeIcon size={14} /> },
      ...libraries.map((lib) => ({
        id: `library:${lib.id}`,
        label: lib.name,
        icon: <KindIcon kind={lib.kind} size={14} />,
      })),
      { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
    ],
    [libraries],
  );

  const activeId =
    view.kind === "home"
      ? "home"
      : view.kind === "settings"
        ? "settings"
        : view.kind === "library"
          ? `library:${view.id}`
          : null;

  const handleSelect = useCallback(
    (id: string) => {
      if (id === "home") setView({ kind: "home" });
      else if (id === "settings") setView({ kind: "settings" });
      else if (id.startsWith("library:")) {
        const libId = Number(id.slice("library:".length));
        if (!Number.isNaN(libId)) setView({ kind: "library", id: libId });
      }
    },
    [setView],
  );

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell
          sidebarItems={sidebarItems}
          activeId={activeId}
          onSelect={handleSelect}
          history={history}
          libraries={libraries}
          progressTick={progressTick}
          notesTick={notesTick}
          refreshLibraries={refreshLibraries}
        />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function ViewFallback() {
  return (
    <div className="space-y-6 px-8 py-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-1/3 animate-pulse rounded-(--radius-card) bg-(--color-surface-raised)" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-video animate-pulse rounded-(--radius-card) bg-(--color-surface-raised)"
          />
        ))}
      </div>
    </div>
  );
}

interface AppShellProps {
  sidebarItems: SidebarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  history: NavHistory;
  libraries: Library[];
  progressTick: number;
  notesTick: number;
  refreshLibraries: () => Promise<void>;
}

function AppShell({
  sidebarItems,
  activeId,
  onSelect,
  history,
  libraries,
  progressTick,
  notesTick,
  refreshLibraries,
}: AppShellProps) {
  const view = history.route;
  const setView = history.navigate;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [captureCtx, setCaptureCtx] = useState<NoteCaptureContext | null>(null);
  const [playerRequest, setPlayerRequest] = useState<PlayerRequest | null>(null);
  const [contextActions, setContextActions] = useState<ReactNode>(null);
  const toast = useToast();
  const crumbs = useBreadcrumb(view, libraries, setView);

  // Views register/unregister their own TopBar actions via useTopBarActions;
  // the unmount cleanup clears stale actions when switching views.

  const toggleMotion = useCallback(() => {
    applyMotion(!getStoredMotion());
  }, []);

  const commands = useMemo(
    () =>
      buildCommands({
        navigate: setView,
        libraries,
        applyTheme,
        toggleMotion,
        rescan: (id) => scanLibrary(id).then(() => refreshLibraries()),
        closePalette: () => setPaletteOpen(false),
      }),
    [setView, libraries, toggleMotion, refreshLibraries],
  );
  const controlsRef = useRef<PlayerControls | null>(null);
  const playSeqRef = useRef(0);

  const play = useCallback((itemId: number, startSeconds?: number) => {
    playSeqRef.current += 1;
    setPlayerRequest({ itemId, startSeconds, seq: playSeqRef.current });
  }, []);

  const closePlayer = useCallback(() => setPlayerRequest(null), []);

  const playerContext = useMemo<PlayerContextValue>(
    () => ({ play, close: closePlayer, controlsRef }),
    [play, closePlayer],
  );

  const triggerNoteCapture = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      toast.push("Start playing a video to capture a note", "info");
      return;
    }
    const pos = controls.getCurrentTime();
    controls.pause();
    setCaptureCtx({ itemId: controls.itemId, timestampSec: pos });
  }, [toast]);

  const openLibrary = useCallback(
    (id: number) => setView({ kind: "library", id }),
    [setView],
  );
  const openGroup = useCallback(
    (id: number) => setView({ kind: "group", id }),
    [setView],
  );

  const closeNoteCapture = useCallback(() => {
    setCaptureCtx(null);
    controlsRef.current?.resume();
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
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
          e.preventDefault();
          history.back();
        } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") {
          e.preventDefault();
          history.forward();
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
      } else if (e.key === "Escape" && history.canBack) {
        e.preventDefault();
        history.back();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [paletteOpen, shortcutsOpen, captureCtx, setView, history, triggerNoteCapture]);

  return (
    <PlayerContext.Provider value={playerContext}>
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
      {/* Overlays mount only while open so their lazy chunks load on first
          use rather than at startup. A null fallback is fine — the chunk
          lands within a frame or two and the trigger already gave feedback. */}
      <Suspense fallback={null}>
        {paletteOpen ? (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            commands={commands}
            onOpenGroup={(id) => {
              setView({ kind: "group", id });
              setPaletteOpen(false);
            }}
          />
        ) : null}
        {shortcutsOpen ? (
          <ShortcutsDialog
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
        ) : null}
        {captureCtx ? (
          <NoteCaptureModal context={captureCtx} onClose={closeNoteCapture} />
        ) : null}
        {playerRequest ? (
          <PlayerOverlay
            request={playerRequest}
            onClose={closePlayer}
            registerControls={(c) => {
              controlsRef.current = c;
            }}
          />
        ) : null}
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          history={history}
          crumbs={crumbs}
          onSearch={() => setPaletteOpen(true)}
          actions={contextActions}
        />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto outline-none"
        >
          <TopBarSlotProvider setActions={setContextActions}>
            <Suspense fallback={<ViewFallback />}>
              {view.kind === "home" ? (
                <Home
                  libraries={libraries}
                  onOpenLibrary={openLibrary}
                  onOpenGroup={openGroup}
                  progressTick={progressTick}
                />
              ) : view.kind === "library" ? (
                <LibraryView
                  libraryId={view.id}
                  onOpenGroup={openGroup}
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
            </Suspense>
          </TopBarSlotProvider>
        </main>
      </div>
    </div>
    </PlayerContext.Provider>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import IconButton from "./IconButton";
import { cn } from "./cn";
import {
  convertFileSrc,
  getItem,
  getNextItem,
  getSetting,
  reportProgress,
} from "@/lib/api";
import type { PlayerControls } from "@/lib/player";
import type { ItemWithProgress } from "@/lib/types";

const REPORT_INTERVAL_MS = 3000;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;
const VOLUME_STEP = 0.1;

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Space / K", action: "Play / pause" },
  { keys: "← / J", action: "Back 10s" },
  { keys: "→ / L", action: "Forward 10s" },
  { keys: "↑ / ↓", action: "Volume up / down" },
  { keys: "M", action: "Mute / unmute" },
  { keys: "[ / ]", action: "Speed down / up" },
  { keys: "0 – 9", action: "Jump to 0%–90%" },
  { keys: "F", action: "Fullscreen" },
  { keys: "Alt + N", action: "Capture note" },
  { keys: "?", action: "Toggle this help" },
  { keys: "Esc", action: "Close player" },
];

export interface PlayerRequest {
  itemId: number;
  startSeconds?: number;
  /** Bumped on every `play()` call so replaying the same item re-seeks. */
  seq: number;
}

export interface PlayerOverlayProps {
  request: PlayerRequest;
  onClose: () => void;
  /** Registers/clears the imperative handle used by Alt+N note capture. */
  registerControls: (controls: PlayerControls | null) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Human-readable reason for an HTMLMediaElement error. */
function mediaErrorMessage(el: HTMLVideoElement): string {
  const err = el.error;
  if (!err) return "Unknown playback error.";
  switch (err.code) {
    case err.MEDIA_ERR_ABORTED:
      return "Playback aborted.";
    case err.MEDIA_ERR_NETWORK:
      return "Network error while loading the file.";
    case err.MEDIA_ERR_DECODE:
      return "Could not decode this file (unsupported codec?). The internal player handles MP4/H.264.";
    case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This container/codec isn't supported by the internal player. Only MP4/H.264 is supported for now.";
    default:
      return err.message || "Unknown playback error.";
  }
}

export default function PlayerOverlay({
  request,
  onClose,
  registerControls,
}: PlayerOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The item currently loaded into <video>. Starts at the requested item and
  // changes on auto-advance without touching the parent's request.
  const [current, setCurrent] = useState<{ itemId: number; start?: number }>({
    itemId: request.itemId,
    start: request.startSeconds,
  });
  const [item, setItem] = useState<ItemWithProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const lastReportRef = useRef(0);

  // Reset to the requested item whenever the parent issues a new play().
  useEffect(() => {
    setCurrent({ itemId: request.itemId, start: request.startSeconds });
  }, [request.itemId, request.seq, request.startSeconds]);

  // Resolve the item to play (file path + resume position).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItem(null);
    getItem(current.itemId)
      .then((it) => {
        if (!cancelled) setItem(it);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [current.itemId]);

  const resumeSeconds =
    current.start ?? item?.progress?.positionSeconds ?? 0;

  const flushProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    reportProgress(current.itemId, v.currentTime, v.duration).catch((e) =>
      console.error("reportProgress failed", e),
    );
  }, [current.itemId]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch((e) => console.error("play() failed", e));
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    v.currentTime = t;
    setPosition(t);
  }, []);

  const seekToFraction = useCallback((frac: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const t = v.duration * frac;
    v.currentTime = t;
    setPosition(t);
  }, []);

  const changeVolume = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(1, v.volume + delta));
    v.volume = next;
    v.muted = next === 0;
    setVolume(next);
    setMuted(v.muted);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const setPlaybackRate = useCallback((next: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = next;
    setRate(next);
  }, []);

  const cycleRate = useCallback(() => {
    const idx = PLAYBACK_RATES.indexOf(rate);
    setPlaybackRate(PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]);
  }, [rate, setPlaybackRate]);

  const stepRate = useCallback(
    (dir: 1 | -1) => {
      const idx = PLAYBACK_RATES.indexOf(rate);
      const next = Math.max(
        0,
        Math.min(PLAYBACK_RATES.length - 1, idx + dir),
      );
      setPlaybackRate(PLAYBACK_RATES[next]);
    },
    [rate, setPlaybackRate],
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Register imperative controls for app-level note capture.
  useEffect(() => {
    registerControls({
      itemId: current.itemId,
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      pause: () => videoRef.current?.pause(),
      resume: () => {
        videoRef.current?.play().catch(() => {});
      },
      seek: (seconds: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = seconds;
        setPosition(seconds);
      },
    });
    return () => registerControls(null);
  }, [current.itemId, registerControls]);

  // Final save when the overlay unmounts.
  useEffect(() => {
    return () => flushProgress();
  }, [flushProgress]);

  useEffect(() => {
    const onFsChange = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setVolume(v.volume);
    if (resumeSeconds > 0 && resumeSeconds < v.duration) {
      v.currentTime = resumeSeconds;
    }
    v.playbackRate = rate;
    // Autoplay may be rejected by the webview's autoplay policy. Retry muted
    // (always allowed) so playback starts; the user can unmute from controls.
    v.play().catch((err) => {
      console.warn("autoplay blocked, retrying muted", err);
      v.muted = true;
      setMuted(true);
      v.play().catch((e) => console.error("muted autoplay also failed", e));
    });
  }, [resumeSeconds, rate]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setPosition(v.currentTime);
    const now = performance.now();
    if (now - lastReportRef.current >= REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      flushProgress();
    }
  }, [flushProgress]);

  const handleError = useCallback(() => {
    const v = videoRef.current;
    const msg = v ? mediaErrorMessage(v) : "Unknown playback error.";
    console.error("video error:", msg, v?.error, "src:", v?.currentSrc);
    setError(msg);
  }, []);

  const handleEnded = useCallback(async () => {
    flushProgress();
    try {
      const autoAdvance = (await getSetting("auto_advance")) === "true";
      const groupId = item?.groupId;
      if (!autoAdvance || groupId == null) return;
      const next = await getNextItem(groupId);
      if (next && next.id !== current.itemId) {
        setCurrent({ itemId: next.id, start: 0 });
      }
    } catch (e) {
      console.error("auto-advance failed", e);
    }
  }, [flushProgress, item, current.itemId]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.currentTarget.value);
    v.currentTime = t;
    setPosition(t);
  }, []);

  const handleClose = useCallback(() => {
    flushProgress();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  }, [flushProgress, onClose]);

  // Keyboard shortcuts (capture phase so they run before the global handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Leave modifier combos (Alt+N note capture, Ctrl+K, …) to the app.
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      switch (e.key) {
        case "Escape":
          if (showHelp) {
            setShowHelp(false);
          } else if (!document.fullscreenElement) {
            handleClose();
          } else {
            return; // let the browser exit fullscreen
          }
          break;
        case " ":
        case "k":
          togglePlay();
          break;
        case "ArrowLeft":
        case "j":
          seekBy(-SKIP_SECONDS);
          break;
        case "ArrowRight":
        case "l":
          seekBy(SKIP_SECONDS);
          break;
        case "ArrowUp":
          changeVolume(VOLUME_STEP);
          break;
        case "ArrowDown":
          changeVolume(-VOLUME_STEP);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "[":
          stepRate(-1);
          break;
        case "]":
          stepRate(1);
          break;
        case "?":
          setShowHelp((s) => !s);
          break;
        default:
          if (e.key >= "0" && e.key <= "9") {
            seekToFraction(Number(e.key) / 10);
            break;
          }
          return; // unhandled — don't preventDefault
      }
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [
    showHelp,
    handleClose,
    togglePlay,
    seekBy,
    seekToFraction,
    changeVolume,
    toggleMute,
    toggleFullscreen,
    stepRate,
  ]);

  const src = item ? convertFileSrc(item.filePath) : undefined;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={item ? `Playing ${item.title}` : "Player"}
    >
      <div className="relative flex flex-1 items-center justify-center">
        {error ? (
          <div className="max-w-md px-6 text-center text-sm text-(--color-text-secondary)">
            <p className="mb-2 font-medium text-(--color-text-primary)">
              Could not play this item
            </p>
            <p>{error}</p>
          </div>
        ) : src ? (
          <video
            key={current.itemId}
            ref={videoRef}
            src={src}
            playsInline
            preload="auto"
            className="h-full w-full"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onError={handleError}
            onVolumeChange={() => {
              const v = videoRef.current;
              if (v) {
                setVolume(v.volume);
                setMuted(v.muted);
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={handleEnded}
            onClick={togglePlay}
          />
        ) : (
          <div className="text-sm text-(--color-text-muted)">Loading…</div>
        )}

        <div className="absolute right-3 top-3 flex items-center gap-2">
          <IconButton
            icon={<Keyboard size={18} />}
            tooltip="Keyboard shortcuts (?)"
            onClick={() => setShowHelp((s) => !s)}
          />
          <IconButton
            icon={<X size={18} />}
            tooltip="Close (Esc)"
            onClick={handleClose}
          />
        </div>

        {showHelp ? (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60"
            onClick={() => setShowHelp(false)}
          >
            <div
              className="w-80 rounded-(--radius-card-lg) border border-(--color-border-subtle) bg-(--color-surface) p-5 shadow-(--shadow-card)"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-3 text-sm font-semibold text-(--color-text-primary)">
                Keyboard shortcuts
              </h2>
              <dl className="space-y-1.5">
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.keys}
                    className="flex items-center justify-between gap-4 text-xs"
                  >
                    <dt className="text-(--color-text-secondary)">{s.action}</dt>
                    <dd>
                      <kbd className="rounded-(--radius-control) border border-(--color-border-subtle) bg-(--color-surface-raised) px-1.5 py-0.5 font-mono text-[11px] text-(--color-text-primary)">
                        {s.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 bg-(--color-surface)/95 px-4 py-3 backdrop-blur">
        {item ? (
          <p className="truncate text-sm font-medium text-(--color-text-primary)">
            {item.title}
          </p>
        ) : null}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(position, duration || 0)}
          onChange={handleScrub}
          aria-label="Seek"
          className="w-full accent-(--color-accent)"
        />
        <div className="flex items-center gap-2 text-(--color-text-secondary)">
          <IconButton
            icon={playing ? <Pause size={18} /> : <Play size={18} />}
            tooltip={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={togglePlay}
          />
          <IconButton
            icon={<RotateCcw size={18} />}
            tooltip="Back 10s (←)"
            onClick={() => seekBy(-SKIP_SECONDS)}
          />
          <IconButton
            icon={<RotateCw size={18} />}
            tooltip="Forward 10s (→)"
            onClick={() => seekBy(SKIP_SECONDS)}
          />
          <IconButton
            icon={<VolumeIcon size={18} />}
            tooltip={muted ? "Unmute (M)" : "Mute (M)"}
            onClick={toggleMute}
          />
          <span className="tabular-nums text-xs text-(--color-text-muted)">
            {formatTime(position)} / {formatTime(duration)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={cycleRate}
              className={cn(
                "rounded-(--radius-control) px-2 py-1 text-xs font-medium tabular-nums",
                "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
              )}
              aria-label="Playback speed ([ and ])"
              title="Playback speed ([ and ])"
            >
              {rate}×
            </button>
            <IconButton
              icon={isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              tooltip="Fullscreen (F)"
              onClick={toggleFullscreen}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

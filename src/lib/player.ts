import { createContext, useContext, type MutableRefObject } from "react";

/** Imperative handle the active player exposes so app-level shortcuts (note
 *  capture) can read the position and pause/resume without prop drilling. */
export interface PlayerControls {
  itemId: number;
  getCurrentTime: () => number;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
}

export interface PlayerContextValue {
  /** Open the in-app player on `itemId`, optionally seeking to `startSeconds`
   *  instead of the saved resume position. */
  play: (itemId: number, startSeconds?: number) => void;
  /** Close the player. */
  close: () => void;
  /** Controls of the live player, or `null` when nothing is playing. */
  controlsRef: MutableRefObject<PlayerControls | null>;
}

export const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerContext");
  return ctx;
}

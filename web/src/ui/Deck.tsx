import { type ReactNode, useState } from "react";
import { Oled } from "./Oled";

export type PlayState = "stopped" | "starting" | "playing";

type Props = {
  title: string;
  subtitle?: string;
  readout?: ReactNode;
  state: PlayState;
  disabled?: boolean;
  onPlay: () => void;
  onStop: () => void;
  autoPlay: boolean;
  onToggleAutoPlay: () => void;
};

// The top line of a sample or song: its OLED and transport.
export function Deck({ title, subtitle, readout, state, disabled, onPlay, onStop, autoPlay, onToggleAutoPlay }: Props) {
  const stopped = state === "stopped";
  return (
    <div className="deck">
      <Oled title={title} subtitle={subtitle} readout={readout} />
      <div className="controls">
        <button
          className={`pad ${state === "playing" ? "lit" : state === "starting" ? "busy" : ""}`}
          aria-label={stopped ? "Play" : "Stop"}
          disabled={disabled}
          onClick={() => (stopped ? onPlay() : onStop())}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {stopped ? <path d="M7 4l13 8-13 8z" /> : <rect x="5" y="5" width="14" height="14" />}
          </svg>
        </button>
        <button
          className="key auto-play"
          aria-pressed={autoPlay}
          title="Play on select, so the arrow keys audition a folder"
          onClick={onToggleAutoPlay}
        >
          <span className="led" />
          Auto play
        </button>
      </div>
    </div>
  );
}

// A flag that's remembered between visits, where the browser allows it.
export function useRememberedFlag(key: string, initial: boolean): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "true";
    } catch {
      return initial;
    }
  });
  function toggle() {
    setOn(!on);
    try {
      localStorage.setItem(key, String(!on));
    } catch {
      // Not remembered, then.
    }
  }
  return [on, toggle];
}

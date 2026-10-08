import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../preview/firmware";
import type { Player } from "../preview/player";

// The player's state as heard now. Play heads move every frame, so onFrame sets them directly rather than through
// React; the state returned changes only when something other than a position does.
export function usePlaybackState(player: Player, onFrame: (state: PlaybackState) => void): PlaybackState {
  const [state, setState] = useState(player.initialState);
  const latestOnFrame = useRef(onFrame);
  useEffect(() => {
    latestOnFrame.current = onFrame;
  });

  useEffect(() => {
    let frame = requestAnimationFrame(function update() {
      const now = player.state() ?? player.initialState;
      setState((previous) => (sameFlags(previous, now) ? previous : now));
      latestOnFrame.current(now);
      frame = requestAnimationFrame(update);
    });
    return () => cancelAnimationFrame(frame);
  }, [player]);

  return state;
}

function sameFlags(a: PlaybackState, b: PlaybackState): boolean {
  return (
    a.playing === b.playing &&
    a.arrangement === b.arrangement &&
    a.switchingToArrangement === b.switchingToArrangement &&
    a.clips.every((s, i) => s.active === b.clips[i].active && s.armed === b.clips[i].armed && s.soloing === b.clips[i].soloing)
  );
}

import { type CSSProperties, useRef } from "react";
import { baseName } from "../card/card";
import type { Player } from "../preview/player";
import { usePlaybackState } from "./usePlaybackState";

type Props = { player: Player; playing: boolean };

// The song's arrangement, like the Deluge's arranger view: a track per instrument, with its clips where they play.
// While it plays, the session can take over, and hand back to the arrangement where it left it.
export function ArrangementView({ player, playing }: Props) {
  const { song } = player;
  const length = Math.max(...song.tracks.flatMap((track) => track.instances.map(([pos, length]) => pos + length)));
  const percent = (ticks: number) => `${(100 * Math.min(ticks, length)) / length}%`;
  const playHeads = useRef<(HTMLDivElement | null)[]>([]);
  const state = usePlaybackState(player, (now) => {
    for (const head of playHeads.current) if (head) head.style.left = percent(now.arrangementPos);
  });
  // Playing to its end stops the song.
  const live = playing && state.playing;

  return (
    <>
      <div className="section-head">
        <h3 className="label">Arrangement</h3>
        {!live ? (
          <span className="hint">Play to switch to the session</span>
        ) : state.arrangement ? (
          <button className="text-button" onClick={() => player.switchTo("session")}>
            Switch to session
          </button>
        ) : state.switchingToArrangement ? (
          <span className="hint">Back to arrangement at loop end</span>
        ) : (
          <button className="text-button" onClick={() => player.switchTo("arrangement")}>
            Back to arrangement
          </button>
        )}
      </div>
      <ul
        className={`tracks ${live && !state.arrangement ? "left" : ""}`}
        style={{ "--bar": percent(4 * song.ticksPerQuarterNote) } as CSSProperties}
      >
        {song.tracks.map((track, i) => (
          <li key={i} className="track">
            <span className="track-name" title={track.name}>
              {baseName(track.name) || track.type}
            </span>
            <div className="track-lane">
              {track.instances.map(([pos, length, colour], j) => (
                <span key={j} className="instance" style={{ left: percent(pos), width: percent(length), background: colour }} />
              ))}
              <div className="play-head" ref={(head) => void (playHeads.current[i] = head)} hidden={!live} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

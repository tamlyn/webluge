import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from "react";
import { baseName, type Card } from "../card/card";
import type { ClipDescription, ClipState } from "../preview/firmware";
import type { SongPlayer } from "../preview/songPlayer";

type Props = { card: Card; player: SongPlayer; audioContext: AudioContext };

// The song's session clips, like the Deluge's session view: each can be started, stopped or soloed while it plays.
export function ClipView({ card, player, audioContext }: Props) {
  const { song } = player;
  const [states, setStates] = useState<ClipState[]>();
  const playHeads = useRef<(HTMLDivElement | null)[]>([]);

  // Play heads move every frame, so they're set directly rather than through React.
  useEffect(() => {
    let frame = requestAnimationFrame(function update() {
      const now = player.clipStates();
      if (now) {
        setStates((previous) => (previous && sameFlags(previous, now) ? previous : now));
        now.forEach((state, i) => {
          const head = playHeads.current[i];
          if (head) head.style.left = `${(100 * state.pos) / song.clips[i].loopLength}%`;
        });
      }
      frame = requestAnimationFrame(update);
    });
    return () => cancelAnimationFrame(frame);
  }, [player, song]);

  if (song.arrangement) {
    return <p className="muted">This song plays its arrangement, so its clips can't be started and stopped here.</p>;
  }
  if (!song.clips.length) return null;
  return (
    <>
      <h3>Clips</h3>
      <ul className="clips">
        {song.clips.map((clip, i) => {
          const state = states?.[i];
          return (
            <li key={i} className={`clip ${state?.active ? "active" : ""}`}>
              <button
                className={`launch ${state?.armed ? "armed" : ""}`}
                style={{ "--clip-colour": clip.colour } as CSSProperties}
                title="Start or stop at the end of its loop. Shift-click to do it now."
                onClick={(event: MouseEvent) => player.toggleClip(i, event.shiftKey)}
              />
              <span className="clip-name" title={clip.output}>
                {baseName(clip.name || clip.output) || clip.type}
                <span className="clip-type">{clip.type}</span>
              </span>
              <button
                className={`solo ${state?.soloing ? "on" : ""}`}
                title="Solo"
                onClick={() => player.soloClip(i)}
              >
                S
              </button>
              <div className="lane">
                {clip.sample ? (
                  <Waveform card={card} clip={clip} audioContext={audioContext} />
                ) : (
                  <Notes clip={clip} ticksPerQuarterNote={song.ticksPerQuarterNote} />
                )}
                <div className="play-head" ref={(head) => void (playHeads.current[i] = head)} hidden={!state?.active} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function sameFlags(a: ClipState[], b: ClipState[]): boolean {
  return a.every((s, i) => s.active === b[i].active && s.armed === b[i].armed && s.soloing === b[i].soloing);
}

const laneWidth = 800;
const laneHeight = 40;

function useLaneCanvas(draw: (context: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, laneWidth, laneHeight);
    draw(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={canvas} width={laneWidth} height={laneHeight} />;
}

// A row per note, or per drum in a kit, across one loop of the clip.
function Notes({ clip, ticksPerQuarterNote }: { clip: ClipDescription; ticksPerQuarterNote: number }) {
  return useLaneCanvas(
    (context) => {
      const x = (ticks: number) => (ticks / clip.loopLength) * laneWidth;
      const style = getComputedStyle(context.canvas);
      for (let beat = 0; beat * ticksPerQuarterNote < clip.loopLength; beat++) {
        context.fillStyle = style.getPropertyValue(beat % 4 ? "--grid" : "--grid-bar");
        context.fillRect(Math.round(x(beat * ticksPerQuarterNote)), 0, 1, laneHeight);
      }
      const rows = (clip.rows ?? []).filter((row) => row.notes.length);
      if (!rows.length) return;
      // Kits show every drum; melodic clips the range of notes they play.
      const ys = clip.type === "kit" ? (clip.rows ?? []).map((_, i) => i) : rows.map((row) => row.y);
      const yOf = (row: (typeof rows)[number]) => (clip.type === "kit" ? clip.rows!.indexOf(row) : row.y);
      const lowest = Math.min(...ys);
      const span = Math.max(...ys) - lowest + 1;
      const rowHeight = laneHeight / span;
      for (const row of rows) {
        const top = laneHeight - (yOf(row) - lowest + 1) * rowHeight;
        context.fillStyle = row.colour;
        for (const [pos, length, velocity] of row.notes) {
          context.globalAlpha = (row.muted ? 0.25 : 1) * (0.35 + (0.65 * velocity) / 127);
          context.fillRect(x(pos), top, Math.max(2, x(length) - 1), Math.max(1, rowHeight - 1));
        }
      }
      context.globalAlpha = 1;
    },
    [clip, ticksPerQuarterNote],
  );
}

// An audio clip's sample, from its start to its end marker, stretched across the loop as the clip plays it.
function Waveform({ card, clip, audioContext }: { card: Card; clip: ClipDescription; audioContext: AudioContext }) {
  const [audio, setAudio] = useState<AudioBuffer>();
  useEffect(() => {
    let current = true;
    card
      .file(clip.sample!.path)
      .then((file) => file && file.arrayBuffer())
      .then((data) => data && audioContext.decodeAudioData(data))
      .then((decoded) => current && decoded && setAudio(decoded))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [card, clip, audioContext]);

  return useLaneCanvas(
    (context) => {
      if (!audio) return;
      const { start, end, rate } = clip.sample!;
      // Decoding resamples to the context's rate.
      const scale = audio.sampleRate / (rate || audio.sampleRate);
      const data = audio.getChannelData(0);
      const first = start * scale;
      const perPixel = ((end - start) * scale) / laneWidth;
      context.fillStyle = clip.colour;
      for (let px = 0; px < laneWidth; px++) {
        let peak = 0;
        const from = Math.floor(first + px * perPixel);
        for (let i = from; i < Math.min(from + perPixel, data.length); i++) peak = Math.max(peak, Math.abs(data[i]));
        const height = Math.max(1, peak * laneHeight);
        context.fillRect(px, (laneHeight - height) / 2, 1, height);
      }
    },
    [audio, clip],
  );
}

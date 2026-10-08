import { useEffect, useRef, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import { isDocument, type SampleIndex } from "../card/sampleIndex";
import { collectSongFiles, findSample } from "../preview/songFiles";
import { SongPlayer } from "../preview/songPlayer";
import { ClipView } from "./ClipView";
import { isAudio, isSong } from "./files";
import { Oled } from "./Oled";
import { SamplePreview } from "./SamplePreview";
import { useAsync } from "./useAsync";

type Props = {
  card: Card;
  path: string;
  index?: SampleIndex;
  audioContext: () => AudioContext;
  onGoTo: (path: string) => void;
};

export function Details(props: Props) {
  const { path } = props;
  return (
    <section className="details">
      {isAudio(path) ? (
        <SampleDetails {...props} />
      ) : isSong(path) ? (
        <SongDetails {...props} />
      ) : isDocument(path) ? (
        <DocumentDetails {...props} />
      ) : (
        <Oled title={baseName(path)} />
      )}
    </section>
  );
}

function withoutExtension(path: string): string {
  return baseName(path).replace(/\.[^.]*$/, "");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function SampleDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const users = index?.usersOf.get(pathKey(path)) ?? [];
  const count = (folder: string) => users.filter((user) => user.toUpperCase().startsWith(`${folder}/`)).length;
  const summary = [plural(count("SONGS"), "song"), plural(count("KITS"), "kit"), plural(count("SYNTHS"), "synth")];
  return (
    <>
      <SamplePreview card={card} path={path} title={withoutExtension(path)} audioContext={audioContext} />
      <div className="section-head">
        <h3 className="label">Used by {index && users.length}</h3>
        {index && users.length > 0 && <span className="hint">{summary.join(" · ")}</span>}
      </div>
      {!index ? (
        <p className="notice muted">Indexing…</p>
      ) : users.length ? (
        <ul className="tiles">
          {users.map((user) => (
            <li key={user}>
              <button className="tile" onClick={() => onGoTo(user)}>
                <span className={`tag ${documentKind(user)}`} />
                <span className="tile-text">
                  <span>{user.slice(user.indexOf("/") + 1).replace(/\.xml$/i, "")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice muted">No songs, kits or synths</p>
      )}
    </>
  );
}

function documentKind(path: string): string {
  return path.split("/")[0].toLowerCase().replace(/s$/, "");
}

// A document's samples, and where on the card each one is, or null if it's missing.
function useSamples(card: Card, path: string, index?: SampleIndex) {
  const samples = index?.samplesOf.get(path);
  const found = useAsync(
    () => Promise.all((samples ?? []).map((sample) => findSample(card, path, sample))),
    [card, path, samples],
  );
  return { samples, found };
}

function samplesSummary({ samples, found }: ReturnType<typeof useSamples>): string {
  if (!samples) return "Indexing…";
  const numMissing = found?.filter((location) => !location).length ?? 0;
  return `${plural(samples.length, "sample")}${found && samples.length ? (numMissing ? `, ${numMissing} missing` : ", all on card") : ""}`;
}

function DocumentDetails({ card, path, index, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  return (
    <>
      <Oled title={withoutExtension(path)} subtitle={`${documentKind(path)} · ${samplesSummary(samples)}`} />
      <SampleTiles {...samples} onGoTo={onGoTo} />
    </>
  );
}

const collapsedTiles = 12;

function SampleTiles({
  samples,
  found,
  onGoTo,
}: ReturnType<typeof useSamples> & { onGoTo: (path: string) => void }) {
  const [all, setAll] = useState(false);
  if (!samples?.length) return null;
  const showing = all ? samples : samples.slice(0, collapsedTiles);
  return (
    <>
      <div className="section-head">
        <h3 className="label">Samples</h3>
        {samples.length > collapsedTiles && (
          <button className="text-button" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${samples.length}`}
          </button>
        )}
      </div>
      <ul className="tiles">
        {showing.map((sample, i) => {
          const location = found?.[i];
          const text = (
            <span className="tile-text">
              <span>{baseName(sample)}</span>
              <small className={found && !location ? "missing" : ""}>
                {found && !location ? "Missing" : parentPath(sample).replace(/^SAMPLES\//i, "")}
              </small>
            </span>
          );
          return (
            <li key={sample}>
              {location ? (
                <button className="tile" onClick={() => onGoTo(location)}>
                  {text}
                </button>
              ) : (
                <div className={`tile ${found ? "missing" : ""}`}>{text}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

type PlaybackState =
  | { state: "stopped" }
  | { state: "loading" }
  | { state: "playing"; player: SongPlayer; context: AudioContext }
  | { state: "failed"; message: string };

function SongDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  const [playback, setPlayback] = useState<PlaybackState>({ state: "stopped" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => () => (playback.state === "playing" ? playback.player.stop() : undefined), [playback]);

  async function play() {
    setPlayback({ state: "loading" });
    try {
      const context = audioContext();
      await context.resume();
      const files = await collectSongFiles(card, path);
      const player = await SongPlayer.play(context, files, path, (message) => setPlayback({ state: "failed", message }));
      // Moved on to another file while it loaded.
      if (!mounted.current) return player.stop();
      setPlayback({ state: "playing", player, context });
    } catch (e) {
      setPlayback({ state: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const song = playback.state === "playing" ? playback.player.song : undefined;
  const mode = song && (song.arrangement ? "Arranger" : `Session · ${plural(song.clips.length, "clip")}`);
  return (
    <>
      <div className="deck">
        <Oled
          title={withoutExtension(path)}
          subtitle={[mode, samplesSummary(samples)].filter(Boolean).join(" · ")}
          readout={playback.state === "playing" && <Tempo player={playback.player} />}
        />
        <button
          className={`pad ${playback.state === "playing" ? "lit" : playback.state === "loading" ? "busy" : ""}`}
          aria-label="Play"
          disabled={playback.state === "loading"}
          onClick={() => playback.state !== "playing" && play()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4l13 8-13 8z" />
          </svg>
        </button>
        <button className="pad" aria-label="Stop" onClick={() => setPlayback({ state: "stopped" })}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" />
          </svg>
        </button>
      </div>
      {playback.state === "failed" && <p className="notice error">{playback.message}</p>}
      {playback.state === "playing" && (
        <ClipView card={card} player={playback.player} audioContext={playback.context} />
      )}
      <SampleTiles {...samples} onGoTo={onGoTo} />
    </>
  );
}

function Tempo({ player }: { player: SongPlayer }) {
  const [bpm, setBpm] = useState<number>();
  useEffect(() => {
    const timer = setInterval(() => setBpm(player.bpm()), 250);
    return () => clearInterval(timer);
  }, [player]);
  return (
    <>
      {bpm?.toFixed(1) ?? "—"}
      <span className="label">BPM</span>
    </>
  );
}

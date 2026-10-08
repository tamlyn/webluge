import { useEffect, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import { isDocument, type SampleIndex } from "../card/sampleIndex";
import { collectSongFiles, findSample } from "../preview/songFiles";
import { SongPlayer } from "../preview/songPlayer";
import { ClipSkeleton, ClipView } from "./ClipView";
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

type Loading = { state: "loading" } | { state: "ready"; player: SongPlayer } | { state: "failed"; message: string };

// Long enough to skip past songs while arrowing through a folder, without loading each one.
const browseDelay = 250;

function SongDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  const [loading, setLoading] = useState<Loading>({ state: "loading" });
  // The latest song loaded, still shown while it loads again after stopping.
  const [shown, setShown] = useState<SongPlayer>();
  const [playing, setPlaying] = useState(false);
  const [loads, setLoads] = useState(0);
  const player = loading.state === "ready" ? loading.player : undefined;

  useEffect(() => {
    let current = true;
    let loaded: SongPlayer | undefined;
    setLoading({ state: "loading" });
    const timer = setTimeout(
      async () => {
        try {
          const files = await collectSongFiles(card, path);
          if (!current) return;
          loaded = await SongPlayer.load(files, path);
          if (!current) return loaded.stop();
          setLoading({ state: "ready", player: loaded });
          setShown(loaded);
        } catch (e) {
          if (current) setLoading({ state: "failed", message: errorMessage(e) });
        }
      },
      loads ? 0 : browseDelay,
    );
    return () => {
      current = false;
      clearTimeout(timer);
      loaded?.stop();
    };
  }, [card, path, loads]);

  // Play waits for the song to load.
  useEffect(() => {
    if (!playing || !player) return;
    player.start(audioContext(), (message) => {
      setLoading({ state: "failed", message });
      setPlaying(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, player]);

  function play() {
    // Resumed while handling the click, as browsers only allow it then.
    void audioContext().resume();
    if (loading.state === "failed") setLoads(loads + 1);
    setPlaying(true);
  }

  function stop() {
    if (!playing) return;
    setPlaying(false);
    setLoads(loads + 1);
  }

  const started = playing ? player : undefined;
  const song = shown?.song;
  const mode = song && (song.arrangement ? "Arranger" : `Session · ${plural(song.clips.length, "clip")}`);
  return (
    <>
      <div className="deck">
        <Oled
          title={withoutExtension(path)}
          subtitle={[mode, samplesSummary(samples)].filter(Boolean).join(" · ")}
          readout={started && <Tempo player={started} />}
        />
        <button
          className={`pad ${started ? "lit" : playing ? "busy" : ""}`}
          aria-label="Play"
          onClick={() => !playing && play()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4l13 8-13 8z" />
          </svg>
        </button>
        <button className="pad" aria-label="Stop" onClick={stop}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" />
          </svg>
        </button>
      </div>
      {loading.state === "failed" && <p className="notice error">{loading.message}</p>}
      {shown ? (
        <ClipView card={card} player={shown} playing={!!started} audioContext={audioContext()} />
      ) : (
        loading.state === "loading" && <ClipSkeleton />
      )}
      <SampleTiles {...samples} onGoTo={onGoTo} />
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

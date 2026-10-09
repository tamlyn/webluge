import { useEffect, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import { findSample, isDocument, type UsageIndex } from "../card/usageIndex";
import { collectDocumentFiles } from "../preview/documentFiles";
import { Player } from "../preview/player";
import { ArrangementView } from "./ArrangementView";
import { DrumPads, Keyboard } from "./Audition";
import { ClipSkeleton, ClipView } from "./ClipView";
import { Deck, type PlayState, useRememberedFlag } from "./Deck";
import { isAudio, isSong } from "./files";
import { Oled } from "./Oled";
import { SamplePreview } from "./SamplePreview";
import { useAsync } from "./useAsync";
import { documentKind, plural } from "./words";

type Props = {
  card: Card;
  path: string;
  index?: UsageIndex;
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
        <PresetDetails {...props} />
      ) : (
        <TextDetails {...props} />
      )}
    </section>
  );
}

// Enough for any settings file or notes, without reading the whole of a firmware image.
const textLimit = 256 * 1024;

type TextFile =
  | { state: "missing" }
  | { state: "binary"; size: number }
  | { state: "text"; size: number; text: string; truncated: boolean };

async function readText(card: Card, path: string): Promise<TextFile> {
  const file = await card.file(path);
  if (!file) return { state: "missing" };
  const bytes = new Uint8Array(await file.slice(0, textLimit).arrayBuffer());
  if (bytes.includes(0)) return { state: "binary", size: file.size };
  // Streaming, so a character cut off at the limit isn't decoded as garbage.
  const text = new TextDecoder().decode(bytes, { stream: file.size > textLimit });
  return { state: "text", size: file.size, text, truncated: file.size > textLimit };
}

function TextDetails({ card, path }: Props) {
  const file = useAsync(() => readText(card, path), [card, path]);
  const size = file && file.state !== "missing" ? formatSize(file.size) : undefined;
  return (
    <>
      <Oled title={baseName(path)} subtitle={size} />
      {file?.state === "missing" && <p className="notice error">Not on the card</p>}
      {file?.state === "binary" && <p className="notice muted">Not a text file</p>}
      {file?.state === "text" && (
        <>
          <pre className="text-file">{file.text}</pre>
          {file.truncated && <p className="notice muted">Showing the first {formatSize(textLimit)}</p>}
        </>
      )}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return plural(bytes, "byte");
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function withoutExtension(path: string): string {
  return baseName(path).replace(/\.[^.]*$/, "");
}

function SampleDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const users = index && (index.usersOf.get(pathKey(path)) ?? []);
  const count = (folder: string) => users?.filter((user) => user.toUpperCase().startsWith(`${folder}/`)).length ?? 0;
  const summary = [plural(count("SONGS"), "song"), plural(count("KITS"), "kit"), plural(count("SYNTHS"), "synth")];
  return (
    <>
      <SamplePreview card={card} path={path} title={withoutExtension(path)} audioContext={audioContext} />
      <LinkList
        title="Used by"
        hint={users?.length ? summary.join(" · ") : undefined}
        links={users?.map((user) => ({
          name: user.slice(user.indexOf("/") + 1).replace(/\.xml$/i, ""),
          detail: documentKind(user),
          to: user,
        }))}
        empty="No songs, kits or synths"
        onGoTo={onGoTo}
      />
    </>
  );
}

// A document's samples, and where on the card each one is, or null if it's missing.
function useSamples(card: Card, path: string, index?: UsageIndex) {
  const samples = index?.documents.get(pathKey(path))?.samples;
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

// A kit or synth, loaded into the firmware as soon as it's selected, to play its drums or notes.
function PresetDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  const [loading, setLoading] = useState<Loading>({ state: "loading" });
  const player = loading.state === "ready" ? loading.player : undefined;

  useEffect(() => {
    setLoading({ state: "loading" });
    const failed = (message: string) => setLoading({ state: "failed", message });
    return loadPlayer(card, path, true, browseDelay, failed, (loaded) => {
      setLoading({ state: "ready", player: loaded });
      // Silent until auditioned, so it can run before the page has been clicked to allow sound.
      loaded.start(audioContext(), failed);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, path]);

  function audition(y: number, on: boolean) {
    // Resumed while handling the press, as browsers only allow it then.
    if (on) void audioContext().resume();
    player?.audition(y, on);
  }

  const kind = documentKind(path);
  return (
    <>
      <Oled title={withoutExtension(path)} subtitle={`${kind} · ${samplesSummary(samples)}`} />
      {loading.state === "failed" ? (
        <p className="notice error">{loading.message}</p>
      ) : kind === "kit" ? (
        <DrumPads kit={player?.song.clips[0]} onAudition={audition} />
      ) : (
        <Keyboard disabled={!player} onAudition={audition} />
      )}
      <SampleList {...samples} onGoTo={onGoTo} />
    </>
  );
}

function SampleList({ samples, found, onGoTo }: ReturnType<typeof useSamples> & { onGoTo: (path: string) => void }) {
  return (
    <LinkList
      title="Samples"
      links={samples?.map((sample, i) => {
        const missing = found && !found[i];
        return {
          name: baseName(sample),
          detail: missing ? "Missing" : parentPath(sample).replace(/^SAMPLES\//i, ""),
          to: found?.[i] ?? undefined,
          missing,
        };
      })}
      empty="No samples"
      onGoTo={onGoTo}
    />
  );
}

type Link = { name: string; detail: string; to?: string; missing?: boolean };

// Songs, kits, synths or samples, one per line. Undefined links are still being indexed.
function LinkList({
  title,
  hint,
  links,
  empty,
  onGoTo,
}: {
  title: string;
  hint?: string;
  links?: Link[];
  empty: string;
  onGoTo: (path: string) => void;
}) {
  return (
    <>
      <div className="section-head">
        <h3 className="label">
          {title} {links?.length || ""}
        </h3>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {!links ? (
        <p className="notice muted">Indexing…</p>
      ) : !links.length ? (
        <p className="notice muted">{empty}</p>
      ) : (
        <ul className="links">
          {links.map((link, i) => {
            const text = (
              <>
                <span className="link-name">{link.name}</span>
                <span className={`link-detail ${link.missing ? "missing" : ""}`}>{link.detail}</span>
              </>
            );
            return (
              <li key={i}>
                {link.to ? (
                  <button className="link" onClick={() => onGoTo(link.to!)}>
                    {text}
                  </button>
                ) : (
                  <div className="link">{text}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

type Loading = { state: "loading" } | { state: "ready"; player: Player } | { state: "failed"; message: string };

// Long enough to skip past songs, kits and synths while arrowing through a folder, without loading each one.
const browseDelay = 250;

// Loads a song, kit or synth into a new firmware instance after the delay. Returns a function that abandons the load,
// or stops the player once it's loaded.
function loadPlayer(
  card: Card,
  path: string,
  preset: boolean,
  delay: number,
  onFailed: (message: string) => void,
  onLoaded: (player: Player) => void,
): () => void {
  let current = true;
  let loaded: Player | undefined;
  const timer = setTimeout(async () => {
    try {
      const files = await collectDocumentFiles(card, path);
      if (!current) return;
      loaded = await Player.load(files, path, preset);
      if (!current) return loaded.stop();
      onLoaded(loaded);
    } catch (e) {
      if (current) onFailed(errorMessage(e));
    }
  }, delay);
  return () => {
    current = false;
    clearTimeout(timer);
    loaded?.stop();
  };
}

function SongDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  const [loading, setLoading] = useState<Loading>({ state: "loading" });
  const [autoPlay, toggleAutoPlay] = useRememberedFlag("webluge.autoPlaySongs", false);
  // The latest song loaded, still shown while it loads again after stopping.
  const [shown, setShown] = useState<Player>();
  // Auto-play presses play as soon as it's selected, and it starts once loaded.
  const [playing, setPlaying] = useState(autoPlay);
  const [loads, setLoads] = useState(0);
  // Played to the end of its arrangement, and still ringing out until it's played again.
  const [ended, setEnded] = useState(false);
  const player = loading.state === "ready" ? loading.player : undefined;

  useEffect(() => {
    setLoading({ state: "loading" });
    setEnded(false);
    const failed = (message: string) => {
      setLoading({ state: "failed", message });
      setPlaying(false);
    };
    return loadPlayer(card, path, false, loads ? 0 : browseDelay, failed, (loaded) => {
      setLoading({ state: "ready", player: loaded });
      setShown(loaded);
    });
  }, [card, path, loads]);

  // Play waits for the song to load.
  useEffect(() => {
    if (!playing || !player) return;
    const context = audioContext();
    // Auto-play starts it without a click, which browsers allow once the page has had one.
    void context.resume();
    player.start(
      context,
      (message) => {
        setLoading({ state: "failed", message });
        setPlaying(false);
      },
      () => {
        setEnded(true);
        setPlaying(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, player]);

  function play() {
    // Resumed while handling the click, as browsers only allow it then.
    void audioContext().resume();
    if (loading.state === "failed" || ended) setLoads(loads + 1);
    setPlaying(true);
  }

  function stop() {
    setPlaying(false);
    setLoads(loads + 1);
  }

  const started = playing ? player : undefined;
  const state: PlayState = started ? "playing" : playing ? "starting" : "stopped";
  const song = shown?.song;
  const mode = song && (song.arrangement ? "Arranger" : `Session · ${plural(song.clips.length, "clip")}`);
  return (
    <>
      <Deck
        title={withoutExtension(path)}
        subtitle={[mode, samplesSummary(samples)].filter(Boolean).join(" · ")}
        readout={started && <Tempo player={started} />}
        state={state}
        onPlay={play}
        onStop={stop}
        autoPlay={autoPlay}
        onToggleAutoPlay={toggleAutoPlay}
      />
      {loading.state === "failed" && <p className="notice error">{loading.message}</p>}
      {shown ? (
        <>
          {shown.song.tracks.length > 0 && <ArrangementView player={shown} playing={!!started} />}
          <ClipView card={card} player={shown} playing={!!started} audioContext={audioContext()} />
        </>
      ) : (
        loading.state === "loading" && <ClipSkeleton />
      )}
      <SampleList {...samples} onGoTo={onGoTo} />
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Tempo({ player }: { player: Player }) {
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

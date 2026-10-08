import { useEffect, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import { isDocument, type UsageIndex } from "../card/usageIndex";
import { collectSongFiles, findSample } from "../preview/songFiles";
import { SongPlayer } from "../preview/songPlayer";
import { ClipSkeleton, ClipView } from "./ClipView";
import { Deck, type PlayState, useRememberedFlag } from "./Deck";
import { isAudio, isSong } from "./files";
import { Oled } from "./Oled";
import { SamplePreview } from "./SamplePreview";
import { useAsync } from "./useAsync";

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
        <DocumentDetails {...props} />
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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

function documentKind(path: string): string {
  return path.split("/")[0].toLowerCase().replace(/s$/, "");
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

function DocumentDetails({ card, path, index, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  return (
    <>
      <Oled title={withoutExtension(path)} subtitle={`${documentKind(path)} · ${samplesSummary(samples)}`} />
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

const collapsedLinks = 12;

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
  const [all, setAll] = useState(false);
  const showing = all ? links : links?.slice(0, collapsedLinks);
  return (
    <>
      <div className="section-head">
        <h3 className="label">
          {title} {links?.length || ""}
        </h3>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {!showing ? (
        <p className="notice muted">Indexing…</p>
      ) : !showing.length ? (
        <p className="notice muted">{empty}</p>
      ) : (
        <ul className="links">
          {showing.map((link, i) => {
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
      {links && links.length > collapsedLinks && (
        <button className="text-button show-all" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${links.length}`}
        </button>
      )}
    </>
  );
}

type Loading = { state: "loading" } | { state: "ready"; player: SongPlayer } | { state: "failed"; message: string };

// Long enough to skip past songs while arrowing through a folder, without loading each one.
const browseDelay = 250;

function SongDetails({ card, path, index, audioContext, onGoTo }: Props) {
  const samples = useSamples(card, path, index);
  const [loading, setLoading] = useState<Loading>({ state: "loading" });
  const [autoPlay, toggleAutoPlay] = useRememberedFlag("webluge.autoPlaySongs", false);
  // The latest song loaded, still shown while it loads again after stopping.
  const [shown, setShown] = useState<SongPlayer>();
  // Auto-play presses play as soon as it's selected, and it starts once loaded.
  const [playing, setPlaying] = useState(autoPlay);
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
          if (!current) return;
          setLoading({ state: "failed", message: errorMessage(e) });
          setPlaying(false);
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
    const context = audioContext();
    // Auto-play starts it without a click, which browsers allow once the page has had one.
    void context.resume();
    player.start(context, (message) => {
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
        <ClipView card={card} player={shown} playing={!!started} audioContext={audioContext()} />
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

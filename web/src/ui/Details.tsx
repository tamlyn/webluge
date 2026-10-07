import { useEffect, useRef, useState } from "react";
import { type Card, baseName } from "../card/card";
import { pathKey } from "../card/references";
import { isDocument, type SampleIndex } from "../card/sampleIndex";
import { collectSongFiles, findSample } from "../preview/songFiles";
import { SongPlayer } from "../preview/songPlayer";
import { isAudio, isSong } from "./files";
import { useAsync } from "./useAsync";

type Props = {
  card: Card;
  path: string;
  index?: SampleIndex;
  audioContext: () => AudioContext;
  onGoTo: (path: string) => void;
};

export function Details({ card, path, index, audioContext, onGoTo }: Props) {
  return (
    <section className="details">
      <h2>{baseName(path)}</h2>
      {isAudio(path) && <SampleDetails card={card} path={path} index={index} onGoTo={onGoTo} />}
      {isSong(path) && <SongPlayback card={card} path={path} audioContext={audioContext} />}
      {isDocument(path) && <SamplesUsed card={card} path={path} index={index} onGoTo={onGoTo} />}
    </section>
  );
}

function SampleDetails({ card, path, index, onGoTo }: Omit<Props, "audioContext">) {
  const url = useObjectUrl(card, path);
  const users = index?.usersOf.get(pathKey(path)) ?? [];
  return (
    <>
      {url && <audio key={url} src={url} controls autoPlay />}
      <h3>Used by</h3>
      {!index ? (
        <p className="muted">Indexing…</p>
      ) : users.length ? (
        <ul className="links">
          {users.map((user) => (
            <li key={user}>
              <button onClick={() => onGoTo(user)}>{user}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No songs, kits or synths</p>
      )}
    </>
  );
}

function useObjectUrl(card: Card, path: string): string | undefined {
  const file = useAsync(() => card.file(path), [card, path]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return file && url;
}

type PlaybackState =
  | { state: "stopped" }
  | { state: "loading" }
  | { state: "playing"; player: SongPlayer }
  | { state: "failed"; message: string };

function SongPlayback({ card, path, audioContext }: { card: Card; path: string; audioContext: () => AudioContext }) {
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
      setPlayback({ state: "playing", player });
    } catch (e) {
      setPlayback({ state: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="playback">
      {playback.state === "playing" ? (
        <button className="primary" onClick={() => setPlayback({ state: "stopped" })}>
          Stop
        </button>
      ) : (
        <button className="primary" onClick={play} disabled={playback.state === "loading"}>
          {playback.state === "loading" ? "Loading…" : "Play"}
        </button>
      )}
      {playback.state === "playing" && playback.player.numMissing > 0 && (
        <span className="warning">Playing without {playback.player.numMissing} missing audio files</span>
      )}
      {playback.state === "failed" && <span className="error">{playback.message}</span>}
    </div>
  );
}

function SamplesUsed({ card, path, index, onGoTo }: Omit<Props, "audioContext">) {
  const samples = index?.samplesOf.get(path);
  const found = useAsync(
    () => Promise.all((samples ?? []).map((sample) => findSample(card, path, sample))),
    [card, path, samples],
  );
  if (!samples) return <p className="muted">Indexing…</p>;
  if (!samples.length) return <h3>No samples</h3>;
  const numMissing = found?.filter((f) => !f).length ?? 0;
  return (
    <>
      <h3>
        {samples.length} samples{numMissing > 0 && <span className="error"> ({numMissing} missing)</span>}
      </h3>
      <ul className="links">
        {samples.map((sample, i) => {
          const location = found?.[i];
          return (
            <li key={sample}>
              {location ? (
                <button onClick={() => onGoTo(location)}>{sample}</button>
              ) : (
                <span className={found ? "missing" : "muted"}>{sample}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

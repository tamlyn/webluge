import { Fragment, useEffect, useRef, useState } from "react";
import { Card } from "./card/card";
import { rememberedCard } from "./card/connect";
import { planRelinks } from "./card/plan";
import { refreshIndex, type UsageIndex } from "./card/usageIndex";
import { sampleRate } from "./preview/firmware";
import { Browser, type Selection } from "./ui/Browser";
import { ConnectCard } from "./ui/ConnectCard";
import { Details } from "./ui/Details";
import { MissingSamples } from "./ui/MissingSamples";
import { useRoute } from "./ui/route";
import { useOperations } from "./ui/useOperations";

const root: Selection = { path: "", folder: true };

export function App() {
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  const [card, setCard] = useState<Card>();

  useEffect(() => {
    rememberedCard().then(setRemembered, () => {});
  }, []);

  if (!card) {
    return <ConnectCard remembered={remembered} onConnect={(handle) => setCard(new Card(handle))} />;
  }
  return <CardView card={card} onEject={() => setCard(undefined)} />;
}

function CardView({ card, onEject }: { card: Card; onEject: () => void }) {
  const [index, setIndex] = useState<UsageIndex>();
  const [indexProgress, setIndexProgress] = useState<string>();
  const [route, navigate] = useRoute();
  const audioContext = useRef<AudioContext>(undefined);
  // The latest index, for refreshing from, however recently it was set.
  const latest = useRef<UsageIndex>(undefined);

  async function refresh(): Promise<UsageIndex> {
    try {
      const refreshed = await refreshIndex(card, latest.current, (done, total) => {
        if (total) setIndexProgress(`Indexing ${done} of ${total}`);
      });
      latest.current = refreshed;
      setIndex(refreshed);
      setIndexProgress(undefined);
      return refreshed;
    } catch (error) {
      setIndexProgress(`Indexing failed: ${error}`);
      throw error;
    }
  }
  const operations = useOperations(card, refresh);

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selection = "view" in route ? root : route;
  const parts = selection.path ? selection.path.split("/") : [];
  const status = operations.status;
  return (
    <div className="app">
      <header className="top">
        <h1>Webluge</h1>
        <nav className="path" aria-label="Path">
          <button onClick={() => navigate(root)} title={card.name}>
            {card.name}
          </button>
          {"view" in route && (
            <>
              <span aria-hidden="true">/</span>
              <button onClick={() => navigate({ view: "missing" })}>Missing samples</button>
            </>
          )}
          {parts.map((part, i) => (
            <Fragment key={i}>
              <span aria-hidden="true">/</span>
              <button
                title={part}
                onClick={() =>
                  navigate({ path: parts.slice(0, i + 1).join("/"), folder: i < parts.length - 1 || selection.folder })
                }
              >
                {part}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="card-name">
          {indexProgress && <span>{indexProgress}</span>}
          {status && (
            <span className={`status ${status.state === "failed" ? "error" : ""}`} role="status">
              {status.message}
            </span>
          )}
          {operations.canUndo && (
            <button className="text-button" onClick={operations.undo}>
              Undo
            </button>
          )}
          <button
            className="key"
            disabled={operations.running}
            onClick={() => {
              onEject();
              navigate(root);
            }}
          >
            Eject
          </button>
        </div>
      </header>
      <div className="body">
        <Browser card={card} selection={selection} index={index} onSelect={navigate} />
        {"view" in route ? (
          <MissingSamples
            card={card}
            index={index}
            busy={operations.running}
            onRelink={(message, relinks) => operations.perform(message, (context) => planRelinks(context, relinks))}
            onGoTo={(path) => navigate({ path, folder: false })}
          />
        ) : operations.running ? (
          // Songs only ever load from a settled card.
          <section className="details empty">Changing the card…</section>
        ) : selection.folder ? (
          <section className="details empty">Pick a song or sample. The arrow keys move through the columns.</section>
        ) : (
          <Details
            key={selection.path}
            card={card}
            path={selection.path}
            index={index}
            audioContext={() => (audioContext.current ??= new AudioContext({ sampleRate }))}
            onGoTo={(path) => navigate({ path, folder: false })}
          />
        )}
      </div>
    </div>
  );
}

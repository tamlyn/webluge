import { Fragment, useEffect, useRef, useState } from "react";
import { Card } from "./card/card";
import { rememberedCard } from "./card/connect";
import { refreshIndex, type UsageIndex } from "./card/usageIndex";
import { sampleRate } from "./preview/firmware";
import { Browser, type Selection } from "./ui/Browser";
import { ConnectCard } from "./ui/ConnectCard";
import { Details } from "./ui/Details";
import { useSelection } from "./ui/route";

const root: Selection = { path: "", folder: true };

export function App() {
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  const [card, setCard] = useState<Card>();
  const [index, setIndex] = useState<UsageIndex>();
  const [indexProgress, setIndexProgress] = useState<string>();
  const [selection, navigate] = useSelection();
  const audioContext = useRef<AudioContext>(undefined);

  useEffect(() => {
    rememberedCard().then(setRemembered, () => {});
  }, []);

  useEffect(() => {
    if (!card) return;
    let current = true;
    setIndex(undefined);
    refreshIndex(card, undefined, (done, total) => current && setIndexProgress(`Indexing ${done} of ${total}`)).then(
      (built) => {
        if (!current) return;
        setIndex(built);
        setIndexProgress(undefined);
      },
      (error) => current && setIndexProgress(`Indexing failed: ${error}`),
    );
    return () => {
      current = false;
    };
  }, [card]);

  if (!card) {
    return (
      <ConnectCard
        remembered={remembered}
        onConnect={(handle) => setCard(new Card(handle))}
      />
    );
  }

  const parts = selection.path ? selection.path.split("/") : [];
  return (
    <div className="app">
      <header className="top">
        <h1>Webluge</h1>
        <nav className="path" aria-label="Path">
          <button onClick={() => navigate(root)} title={card.name}>
            {card.name}
          </button>
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
          <button
            className="key"
            onClick={() => {
              setCard(undefined);
              navigate(root);
            }}
          >
            Eject
          </button>
        </div>
      </header>
      <div className="body">
        <Browser card={card} selection={selection} index={index} onSelect={navigate} />
        {selection.folder ? (
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

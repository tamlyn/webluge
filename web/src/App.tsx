import { useEffect, useRef, useState } from "react";
import { Card } from "./card/card";
import { rememberedCard } from "./card/connect";
import { buildSampleIndex, type SampleIndex } from "./card/sampleIndex";
import { sampleRate } from "./preview/firmware";
import { Browser, type Selection } from "./ui/Browser";
import { ConnectCard } from "./ui/ConnectCard";
import { Details } from "./ui/Details";

const root: Selection = { path: "", folder: true };

export function App() {
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  const [card, setCard] = useState<Card>();
  const [index, setIndex] = useState<SampleIndex>();
  const [indexProgress, setIndexProgress] = useState<string>();
  const [selection, setSelection] = useState(root);
  const audioContext = useRef<AudioContext>(undefined);

  useEffect(() => {
    rememberedCard().then(setRemembered, () => {});
  }, []);

  useEffect(() => {
    if (!card) return;
    let current = true;
    setIndex(undefined);
    buildSampleIndex(card, (done, total) => current && setIndexProgress(`Indexing ${done} of ${total}`)).then(
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
        onConnect={(handle) => {
          setCard(new Card(handle));
          setSelection(root);
        }}
      />
    );
  }

  const parts = selection.path ? selection.path.split("/") : [];
  return (
    <div className="app">
      <header className="top">
        <h1>Webluge</h1>
        <nav className="path" aria-label="Path">
          <button onClick={() => setSelection(root)}>{card.name}</button>
          {parts.map((part, i) => (
            <span key={i}>
              {"/ "}
              <button
                onClick={() =>
                  setSelection({ path: parts.slice(0, i + 1).join("/"), folder: i < parts.length - 1 || selection.folder })
                }
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div className="card-name">
          {indexProgress && <span>{indexProgress}</span>}
          <button className="key" onClick={() => setCard(undefined)}>
            Eject
          </button>
        </div>
      </header>
      <div className="body">
        <Browser card={card} selection={selection} index={index} onSelect={setSelection} />
        {selection.folder ? (
          <section className="details empty">Pick a song or sample. The arrow keys move through the columns.</section>
        ) : (
          <Details
            key={selection.path}
            card={card}
            path={selection.path}
            index={index}
            audioContext={() => (audioContext.current ??= new AudioContext({ sampleRate }))}
            onGoTo={(path) => setSelection({ path, folder: false })}
          />
        )}
      </div>
    </div>
  );
}

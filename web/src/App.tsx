import { useEffect, useRef, useState } from "react";
import { Card, parentPath } from "./card/card";
import { rememberedCard } from "./card/connect";
import { buildSampleIndex, type SampleIndex } from "./card/sampleIndex";
import { sampleRate } from "./preview/firmware";
import { ConnectCard } from "./ui/ConnectCard";
import { Details } from "./ui/Details";
import { FolderList } from "./ui/FolderList";

export function App() {
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  const [card, setCard] = useState<Card>();
  const [index, setIndex] = useState<SampleIndex>();
  const [indexProgress, setIndexProgress] = useState<string>();
  const [folder, setFolder] = useState("");
  const [selected, setSelected] = useState<string>();
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
          setFolder("");
          setSelected(undefined);
        }}
      />
    );
  }

  function goTo(path: string) {
    setFolder(parentPath(path));
    setSelected(path);
  }

  return (
    <div className="app">
      <header>
        <h1>Webluge</h1>
        {indexProgress && <span className="muted">{indexProgress}</span>}
        <button onClick={() => setCard(undefined)}>Close card</button>
      </header>
      <FolderList
        card={card}
        folder={folder}
        selected={selected}
        index={index}
        onOpenFolder={(path) => {
          setFolder(path);
          setSelected(undefined);
        }}
        onSelect={setSelected}
      />
      {selected ? (
        <Details
          key={selected}
          card={card}
          path={selected}
          index={index}
          audioContext={() => (audioContext.current ??= new AudioContext({ sampleRate }))}
          onGoTo={goTo}
        />
      ) : (
        <section className="details muted">Pick a song or sample. Use the arrow keys to step through a folder.</section>
      )}
    </div>
  );
}

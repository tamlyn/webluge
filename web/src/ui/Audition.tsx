import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ClipDescription } from "../preview/firmware";

// A kit's drum, by its row, or a synth's note, on or off.
type Audition = (y: number, on: boolean) => void;

// A kit's drums as pads, the first at the bottom left as in the Deluge's keyboard view. Undefined while it loads.
export function DrumPads({ kit, onAudition }: { kit?: ClipDescription; onAudition: Audition }) {
  return (
    <>
      <div className="section-head">
        <h3 className="label">Drums {kit?.rows?.length || ""}</h3>
        <span className="hint">Hold a pad to play it</span>
      </div>
      <div className="drum-pads" aria-busy={!kit}>
        {kit
          ? kit.rows!.map((row, y) => (
              <HoldButton
                key={y}
                className="drum-pad"
                style={{ "--pad-colour": row.colour } as CSSProperties}
                onHold={(on) => onAudition(y, on)}
              >
                {row.name || `Drum ${y + 1}`}
              </HoldButton>
            ))
          : Array.from({ length: 8 }, (_, i) => <span key={i} className="drum-pad skeleton" />)}
      </div>
    </>
  );
}

const numOctaves = 2;
const highestNote = 127;

const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// The Deluge calls middle C (60) C3.
function noteName(note: number): string {
  return `${pitchClasses[note % 12]}${Math.floor(note / 12) - 2}`;
}

function isBlack(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(note % 12);
}

// Two octaves of a synth's notes, which can be moved up and down.
export function Keyboard({ disabled, onAudition }: { disabled: boolean; onAudition: Audition }) {
  const [lowest, setLowest] = useState(48);
  const highest = lowest + 12 * numOctaves;
  const notes = Array.from({ length: highest - lowest + 1 }, (_, i) => lowest + i);
  const whites = notes.filter((note) => !isBlack(note));
  return (
    <>
      <div className="section-head">
        <h3 className="label">Keys</h3>
        <span className="octaves">
          <button className="text-button" disabled={lowest === 0} onClick={() => setLowest(lowest - 12)}>
            Oct −
          </button>
          <span className="hint">
            {noteName(lowest)}–{noteName(highest)}
          </span>
          <button className="text-button" disabled={highest + 12 > highestNote} onClick={() => setLowest(lowest + 12)}>
            Oct +
          </button>
        </span>
      </div>
      <div className="keyboard" style={{ "--whites": whites.length } as CSSProperties}>
        {notes.map((note) => (
          <HoldButton
            key={note}
            className={isBlack(note) ? "black" : "white"}
            // Black keys sit on the line between the white keys either side.
            style={isBlack(note) ? ({ "--at": whites.filter((white) => white < note).length } as CSSProperties) : {}}
            label={noteName(note)}
            disabled={disabled}
            onHold={(on) => onAudition(note, on)}
          >
            {note % 12 === 0 && <span className="label">{noteName(note)}</span>}
          </HoldButton>
        ))}
      </div>
    </>
  );
}

// Sounds while held, by pointer or by Space or Enter, as an audition pad does.
function HoldButton({
  className,
  style,
  label,
  disabled,
  onHold,
  children,
}: {
  className: string;
  style: CSSProperties;
  label?: string;
  disabled?: boolean;
  onHold: (on: boolean) => void;
  children: ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const holding = useRef(false);
  const latest = useRef(onHold);
  latest.current = onHold;

  function hold(on: boolean) {
    if (holding.current === on) return;
    holding.current = on;
    setHeld(on);
    latest.current(on);
  }

  // Let go if it goes while held, as a key does when the octave changes.
  useEffect(
    () => () => {
      if (holding.current) latest.current(false);
    },
    [],
  );

  const isPress = (event: KeyboardEvent) => event.key === " " || event.key === "Enter";
  return (
    <button
      className={`${className} ${held ? "lit" : ""}`}
      style={style}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        hold(true);
      }}
      onLostPointerCapture={() => hold(false)}
      onKeyDown={(event) => {
        if (!isPress(event)) return;
        event.preventDefault();
        hold(true);
      }}
      onKeyUp={(event) => isPress(event) && hold(false)}
      onBlur={() => hold(false)}
    >
      {children}
    </button>
  );
}

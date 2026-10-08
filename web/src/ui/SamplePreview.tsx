import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { Card } from "../card/card";
import { Deck, useRememberedFlag } from "./Deck";

type Props = { card: Card; path: string; title: string; audioContext: () => AudioContext };

// A sample's waveform, played when it's selected so a folder can be auditioned with the arrow keys. Clicking or
// dragging across the waveform plays from there.
export function SamplePreview({ card, path, title, audioContext }: Props) {
  // Null if it can't be decoded.
  const [audio, setAudio] = useState<AudioBuffer | null>();
  const [playing, setPlaying] = useState(false);
  const [autoPlay, toggleAutoPlay] = useRememberedFlag("webluge.autoPlay", true);
  // When it would have started had it played from the beginning.
  const source = useRef<{ node: AudioBufferSourceNode; startedAt: number }>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const position = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let current = true;
    card
      .file(path)
      .then((file) => file && file.arrayBuffer())
      .then((data) => (data ? audioContext().decodeAudioData(data) : null))
      .then((decoded) => current && setAudio(decoded), () => current && setAudio(null));
    return () => {
      current = false;
    };
  }, [card, path, audioContext]);

  useEffect(() => {
    if (audio && autoPlay) play();
    return stop;
    // Only once it's decoded: toggling auto-play doesn't start or stop it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  // The waveform redraws every frame while it plays, to move the play head.
  useEffect(() => {
    if (!audio) return;
    const peaks = new Map<number, Float32Array>();
    function draw() {
      const now = source.current ? audioContext().currentTime - source.current.startedAt : 0;
      if (canvas.current) drawWaveform(canvas.current, audio!, peaks, Math.min(1, now / audio!.duration));
      if (position.current) position.current.textContent = (source.current ? now : audio!.duration).toFixed(2);
    }
    let frame = requestAnimationFrame(function update() {
      draw();
      if (source.current) frame = requestAnimationFrame(update);
    });
    const resized = new ResizeObserver(draw);
    if (canvas.current) resized.observe(canvas.current);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
    };
  }, [audio, playing, audioContext]);

  function play(offset = 0) {
    if (!audio) return;
    stop();
    const context = audioContext();
    context.resume();
    const node = context.createBufferSource();
    node.buffer = audio;
    node.connect(context.destination);
    node.start(0, offset);
    source.current = { node, startedAt: context.currentTime - offset };
    node.onended = () => {
      if (source.current?.node !== node) return;
      source.current = undefined;
      setPlaying(false);
    };
    setPlaying(true);
  }

  function stop() {
    const node = source.current?.node;
    source.current = undefined;
    node?.stop();
    setPlaying(false);
  }

  function scrub(event: PointerEvent<HTMLCanvasElement>) {
    if (!audio) return;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    play(Math.min(1, Math.max(0, (event.clientX - left) / width)) * audio.duration);
  }

  const format =
    audio === null
      ? "Can't decode this file"
      : audio && `${audio.numberOfChannels === 1 ? "Mono" : "Stereo"} · ${audio.duration.toFixed(2)} s`;
  return (
    <>
      <Deck
        title={title}
        subtitle={format}
        readout={
          audio && (
            <>
              <span ref={position} />
              <span className="label">Sec</span>
            </>
          )
        }
        state={playing ? "playing" : "stopped"}
        disabled={!audio}
        onPlay={play}
        onStop={stop}
        autoPlay={autoPlay}
        onToggleAutoPlay={toggleAutoPlay}
      />
      <div className="oled">
        <canvas
          className="waveform"
          ref={canvas}
          role="img"
          aria-label={`Waveform of ${title}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            scrub(event);
          }}
          onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && scrub(event)}
        />
        {audio && (
          <div className="scale">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>{(f * audio.duration).toFixed(2)}</span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const barWidth = 5;
const barPitch = 8;

// Bars like the OLED's pixels: white where it has played, grey after.
function drawWaveform(canvas: HTMLCanvasElement, audio: AudioBuffer, cache: Map<number, Float32Array>, progress: number) {
  const scale = devicePixelRatio;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale;
    canvas.height = height * scale;
  }
  const numBars = Math.floor(width / barPitch);
  let peaks = cache.get(numBars);
  if (!peaks) cache.set(numBars, (peaks = barPeaks(audio, numBars)));
  const context = canvas.getContext("2d")!;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  const style = getComputedStyle(canvas);
  peaks.forEach((peak, i) => {
    const barHeight = Math.max(2, peak * height);
    context.fillStyle = i / numBars < progress ? style.getPropertyValue("--bright") : "#7c7c82";
    context.fillRect(i * barPitch, Math.round((height - barHeight) / 2), barWidth, Math.round(barHeight));
  });
  if (progress > 0 && progress < 1) {
    context.fillStyle = style.getPropertyValue("--accent");
    context.fillRect(Math.round(progress * width) - 1, 0, 2, height);
  }
}

function barPeaks(audio: AudioBuffer, numBars: number): Float32Array {
  const peaks = new Float32Array(numBars);
  const perBar = audio.length / numBars;
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let bar = 0; bar < numBars; bar++) {
      const end = Math.min(data.length, Math.floor((bar + 1) * perBar));
      for (let i = Math.floor(bar * perBar); i < end; i++) peaks[bar] = Math.max(peaks[bar], Math.abs(data[i]));
    }
  }
  return peaks;
}

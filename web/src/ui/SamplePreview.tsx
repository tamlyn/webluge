import { useEffect, useRef, useState } from "react";
import type { Card } from "../card/card";
import { Oled } from "./Oled";

type Props = { card: Card; path: string; title: string; audioContext: () => AudioContext };

const autoPlayKey = "webluge.autoPlay";

function rememberedAutoPlay(): boolean {
  try {
    return localStorage.getItem(autoPlayKey) !== "false";
  } catch {
    return true;
  }
}

// A sample's waveform on the OLED, played when it's selected so a folder can be auditioned with the arrow keys.
export function SamplePreview({ card, path, title, audioContext }: Props) {
  // Null if it can't be decoded.
  const [audio, setAudio] = useState<AudioBuffer | null>();
  const [playing, setPlaying] = useState(false);
  const [autoPlay, setAutoPlay] = useState(rememberedAutoPlay);
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

  function play() {
    if (!audio) return;
    stop();
    const context = audioContext();
    context.resume();
    const node = context.createBufferSource();
    node.buffer = audio;
    node.connect(context.destination);
    node.start();
    source.current = { node, startedAt: context.currentTime };
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

  function toggleAutoPlay() {
    setAutoPlay(!autoPlay);
    try {
      localStorage.setItem(autoPlayKey, String(!autoPlay));
    } catch {
      // Not remembered, then.
    }
  }

  const format =
    audio === null
      ? "Can't decode this file"
      : audio && `${audio.numberOfChannels === 1 ? "Mono" : "Stereo"} · ${audio.duration.toFixed(2)} s`;
  return (
    <>
      <Oled
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
      >
        <canvas className="waveform" ref={canvas} role="img" aria-label={`Waveform of ${title}`} />
        {audio && (
          <div className="scale">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>{(f * audio.duration).toFixed(2)}</span>
            ))}
          </div>
        )}
      </Oled>
      <div className="transport">
        <button
          className={`pad ${playing ? "lit" : ""}`}
          aria-label={playing ? "Stop" : "Play"}
          disabled={!audio}
          onClick={playing ? stop : play}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {playing ? <rect x="5" y="5" width="14" height="14" /> : <path d="M7 4l13 8-13 8z" />}
          </svg>
        </button>
        <button className="key" aria-pressed={autoPlay} onClick={toggleAutoPlay}>
          Play on select: {autoPlay ? "on" : "off"}
        </button>
        <span className="label">↑ ↓ steps through the folder</span>
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

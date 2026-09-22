// All game sound is synthesised with WebAudio: no audio files to download,
// and the engine note follows the car's speed exactly.
import { settings } from "./settings";

type EngineVoice = { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let engine: EngineVoice | null = null;
let squeal: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let music: { timer: number; step: number; next: number } | null = null;

const GEARS = [0, 55, 95, 135, 175, 215, 999];

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.connect(master);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  applySettings();
  return ctx;
}

/** Browsers only start audio from a user gesture; call from a click handler. */
export function unlockAudio() {
  const c = context();
  if (c && c.state === "suspended") void c.resume();
}

export function applySettings() {
  if (!ctx || !sfxBus || !musicBus) return;
  const s = settings.get();
  sfxBus.gain.setTargetAtTime(s.sound ? 0.9 : 0, ctx.currentTime, 0.05);
  musicBus.gain.setTargetAtTime(s.music ? 0.32 : 0, ctx.currentTime, 0.05);
}

function noiseSource(c: AudioContext): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  return src;
}

// ---------- engine and tyres ----------

export function startEngine() {
  const c = context();
  if (!c || !sfxBus || engine) return;
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  const sub = c.createOscillator();
  sub.type = "square";
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 4;
  const gain = c.createGain();
  gain.gain.value = 0;
  const subGain = c.createGain();
  subGain.gain.value = 0.5;
  osc.connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(gain).connect(sfxBus);
  osc.start();
  sub.start();
  engine = { osc, sub, filter, gain };
  setEngine(0, false);

  const src = noiseSource(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1900;
  band.Q.value = 6;
  const squealGain = c.createGain();
  squealGain.gain.value = 0;
  src.connect(band).connect(squealGain).connect(sfxBus);
  src.start();
  squeal = { src, gain: squealGain };
}

export function stopEngine() {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (engine) {
    const e = engine;
    e.gain.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => {
      e.osc.stop();
      e.sub.stop();
    }, 400);
    engine = null;
  }
  if (squeal) {
    const s = squeal;
    s.gain.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => s.src.stop(), 300);
    squeal = null;
  }
}

/** Engine note from speed with simulated gear changes; boost adds a harder edge. */
export function setEngine(kmh: number, boosting: boolean, drifting = false) {
  if (!ctx || !engine) return;
  const t = ctx.currentTime;
  let gear = 1;
  while (gear < GEARS.length - 1 && kmh > GEARS[gear]) gear++;
  const low = GEARS[gear - 1];
  const high = Math.min(GEARS[gear], 240);
  const rpm = Math.min(1, Math.max(0, (kmh - low) / Math.max(1, high - low)));
  const base = 48 + gear * 6 + rpm * 70 + (boosting ? 18 : 0);
  engine.osc.frequency.setTargetAtTime(base, t, 0.05);
  engine.sub.frequency.setTargetAtTime(base / 2, t, 0.05);
  engine.filter.frequency.setTargetAtTime(500 + rpm * 1400 + (boosting ? 900 : 0), t, 0.06);
  engine.gain.gain.setTargetAtTime(0.09 + rpm * 0.05 + (boosting ? 0.04 : 0), t, 0.08);
  if (squeal) squeal.gain.gain.setTargetAtTime(drifting && kmh > 40 ? 0.1 : 0, t, drifting ? 0.04 : 0.1);
}

// ---------- one-shots ----------

function tone(freq: number, duration: number, type: OscillatorType, volume: number, endFreq?: number, delay = 0) {
  const c = context();
  if (!c || !sfxBus) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function burst(duration: number, from: number, to: number, volume: number, type: BiquadFilterType = "bandpass") {
  const c = context();
  if (!c || !sfxBus) return;
  const t = c.currentTime;
  const src = noiseSource(c);
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(gain).connect(sfxBus);
  src.start(t);
  src.stop(t + duration + 0.05);
}

export const sfx = {
  click: () => tone(880, 0.06, "triangle", 0.08),
  countdown: () => tone(520, 0.22, "square", 0.12),
  go: () => tone(1040, 0.5, "square", 0.14),
  checkpoint: (ahead: boolean) => tone(ahead ? 1320 : 660, 0.12, "triangle", 0.1),
  lap: () => {
    tone(784, 0.12, "triangle", 0.12);
    tone(1175, 0.2, "triangle", 0.12, undefined, 0.1);
  },
  boost: () => {
    burst(0.7, 300, 3000, 0.35);
    tone(180, 0.5, "sawtooth", 0.08, 520);
  },
  impact: (strength: number) => {
    burst(0.25, 900, 120, 0.25 + strength * 0.4, "lowpass");
    tone(90, 0.2, "sine", 0.3 * (0.4 + strength), 40);
  },
  finish: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, "triangle", 0.12, undefined, i * 0.11));
  },
  reward: () => {
    [1047, 1319, 1568].forEach((f, i) => tone(f, 0.25, "sine", 0.1, undefined, i * 0.08));
  },
};

// ---------- music ----------

// A 16-step synthwave loop: pulsing bass, arpeggio and hats, in A minor.
const BASS = [45, 45, 45, 45, 41, 41, 41, 41, 43, 43, 43, 43, 40, 40, 40, 40];
const ARP = [69, 72, 76, 72, 65, 69, 72, 69, 67, 71, 74, 71, 64, 68, 71, 76];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function musicNote(freq: number, at: number, duration: number, type: OscillatorType, volume: number, cutoff: number) {
  if (!ctx || !musicBus) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(filter).connect(gain).connect(musicBus);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

function hat(at: number, volume: number) {
  if (!ctx || !musicBus) return;
  const src = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  src.connect(filter).connect(gain).connect(musicBus);
  src.start(at);
  src.stop(at + 0.08);
}

export function startMusic() {
  const c = context();
  if (!c || music) return;
  const stepSeconds = 60 / 118 / 4;
  music = { timer: 0, step: 0, next: c.currentTime + 0.1 };
  const tick = () => {
    if (!ctx || !music) return;
    // Schedule a little ahead so timer jitter never causes gaps.
    while (music.next < ctx.currentTime + 0.2) {
      const s = music.step % 16;
      const bar = Math.floor(music.step / 16) % 4;
      musicNote(midi(BASS[s]), music.next, stepSeconds * 0.9, "sawtooth", 0.16, 600);
      if (bar > 0) musicNote(midi(ARP[s] + (bar === 3 ? 12 : 0)), music.next, stepSeconds * 0.8, "square", 0.05, 2400);
      hat(music.next, s % 4 === 2 ? 0.08 : 0.03);
      if (s % 4 === 0) musicNote(55, music.next, 0.18, "sine", 0.35, 200);
      music.next += stepSeconds;
      music.step++;
    }
  };
  music.timer = window.setInterval(tick, 50);
  tick();
}

export function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  music = null;
}

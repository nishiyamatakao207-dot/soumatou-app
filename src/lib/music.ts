/* BGM：アプリの中で作曲・演奏する音楽。
 *
 * 他の人が作った音源（録音・サンプル）は一切使わず、ここに書いた楽譜と音色の設計から
 * ブラウザの音声機能（Web Audio）で音を作る。そのため第三者の著作権にかかわらない。
 *
 * 曲は数十秒の「ひと回り」を作り、継ぎ目なくくり返して使う。
 * （2回分演奏して後半だけ切り出すので、残響もつながって自然にループする） */

import { seeded } from './movie';
import { db } from '../data/db';

export type BgmMood = 'gentle' | 'bright' | 'calm' | 'piano' | 'guitar';
/** 和音と分散和音の決まった形で作る曲 */
type PatternMood = 'gentle' | 'bright' | 'calm';
export type BgmChoice = 'none' | BgmMood | 'custom';

export const BGM_OPTIONS: { value: BgmChoice; label: string; note: string }[] = [
  { value: 'none', label: 'なし', note: '' },
  { value: 'gentle', label: 'やさしい', note: 'オルゴールのような、ゆったりした曲' },
  { value: 'bright', label: '明るい', note: '軽やかで楽しい曲' },
  { value: 'calm', label: 'しっとり', note: 'ゆったりした、少し切ない曲' },
  { value: 'piano', label: 'ピアノ', note: 'ピアノ1台で弾く、やさしくあたたかい曲' },
  { value: 'guitar', label: 'ギター', note: 'アコースティックギターの指弾き。家族の日常に' },
  { value: 'custom', label: '自分の曲', note: 'スマホの中の音楽ファイル' },
];

export const SAMPLE_RATE = 48000;
/** 作曲するときの細かさ。やわらかい音楽なので少し粗くても聞き分けにくく、作るのが速くなる */
const MUSIC_RATE = 32000;
/** 曲の作り方を変えたら上げる（端末に保存した曲を作り直すため） */
const MUSIC_VERSION = 3;

type Voice = 'bell' | 'pluck' | 'piano';

interface Song {
  bpm: number;
  /** 調の基準の音（MIDI番号） */
  root: number;
  /** コード（基準の音からの半音の数） */
  chords: number[][];
  barsPerChord: number;
  /** ひと回りで、コード進行を何回くり返すか */
  repeats: number;
  arp: { voice: Voice; perBeat: number; octave: number; level: number; pattern: number[] };
  melody: { voice: Voice; octave: number; level: number; density: number };
  pad: number;
  bass: { level: number; perBar: number };
  shaker: number;
  reverbSec: number;
  wet: number;
  /** 旋律に使う音（基準の音からの半音） */
  scale: number[];
}

const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];

const SONGS: Record<PatternMood, Song> = {
  // やさしい：ヘ長調・ゆっくり。オルゴールの分散和音にやわらかい和音
  gentle: {
    bpm: 70,
    root: 65,
    chords: [
      [0, 4, 7],
      [-1, 2, 7],
      [-3, 0, 4],
      [-7, -3, 0],
    ],
    barsPerChord: 2,
    repeats: 2,
    arp: { voice: 'bell', perBeat: 2, octave: 12, level: 0.13, pattern: [0, 1, 2, 3, 2, 1, 0, 2] },
    melody: { voice: 'bell', octave: 24, level: 0.12, density: 0.45 },
    pad: 0.05,
    bass: { level: 0.06, perBar: 1 },
    shaker: 0,
    reverbSec: 3,
    wet: 0.42,
    scale: MAJOR_PENTA,
  },
  // 明るい：ト長調・軽快。はじくような音と、軽いリズム
  bright: {
    bpm: 100,
    root: 67,
    chords: [
      [0, 4, 7],
      [-5, -1, 2],
      [-3, 0, 4],
      [-7, -3, 0],
    ],
    barsPerChord: 1,
    repeats: 4,
    arp: { voice: 'pluck', perBeat: 2, octave: 0, level: 0.12, pattern: [0, 2, 1, 2, 0, 2, 1, 3] },
    melody: { voice: 'bell', octave: 12, level: 0.11, density: 0.55 },
    pad: 0.035,
    bass: { level: 0.075, perBar: 4 },
    shaker: 0.035,
    reverbSec: 1.8,
    wet: 0.28,
    scale: MAJOR_PENTA,
  },
  // しっとり：イ短調・ゆっくり。ピアノのような音と、長い残響
  calm: {
    bpm: 62,
    root: 57,
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [3, 7, 10],
      [-2, 2, 5],
    ],
    barsPerChord: 2,
    repeats: 2,
    arp: { voice: 'piano', perBeat: 1, octave: 12, level: 0.12, pattern: [0, 1, 2, 1] },
    melody: { voice: 'piano', octave: 24, level: 0.13, density: 0.4 },
    pad: 0.055,
    bass: { level: 0.065, perBar: 1 },
    shaker: 0,
    reverbSec: 3.8,
    wet: 0.48,
    scale: MINOR_PENTA,
  },
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** 残響（部屋の響き）の元になる音を作る */
function impulse(ctx: BaseAudioContext, sec: number) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rnd = seeded('reverb');
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

/** 1音を鳴らす（音色ごとに倍音と減衰を変える） */
function note(ctx: BaseAudioContext, out: AudioNode, voice: Voice, midi: number, t: number, level: number) {
  const f = hz(midi);
  const parts: [number, number, OscillatorType][] =
    voice === 'bell'
      ? [
          [1, 1, 'sine'],
          [2, 0.28, 'sine'],
          [4.2, 0.07, 'sine'],
        ]
      : voice === 'pluck'
        ? [
            [1, 1, 'triangle'],
            [2, 0.2, 'sine'],
          ]
        : [
            [1, 1, 'sine'],
            [2, 0.38, 'sine'],
            [3, 0.12, 'sine'],
            [4, 0.05, 'sine'],
          ];
  const decay = voice === 'bell' ? 0.9 : voice === 'pluck' ? 0.32 : 1.25;
  const length = decay * 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.006);
  g.gain.setTargetAtTime(0, t + 0.006, decay);
  g.connect(out);
  for (const [mul, amp, type] of parts) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f * mul;
    const pg = ctx.createGain();
    // 高い倍音ほど早く消える
    pg.gain.setValueAtTime(amp, t);
    pg.gain.setTargetAtTime(0, t, decay / mul);
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + length);
  }
}

/** ゆっくり立ち上がる和音（背景の空気） */
function pad(ctx: BaseAudioContext, out: AudioNode, midis: number[], t: number, dur: number, level: number) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + Math.min(1.4, dur / 2));
  g.gain.setValueAtTime(level, t + dur - 0.2);
  g.gain.linearRampToValueAtTime(0, t + dur + 1.6);
  lp.connect(g).connect(out);
  for (const m of midis) {
    for (const [type, cents] of [
      ['triangle', -6],
      ['sine', 7],
    ] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 1.8);
    }
  }
}

function bassNote(ctx: BaseAudioContext, out: AudioNode, midi: number, t: number, dur: number, level: number) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = hz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.03);
  g.gain.setTargetAtTime(level * 0.5, t + 0.03, dur / 2);
  g.gain.setTargetAtTime(0, t + dur * 0.92, 0.08);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.5);
}

function shaker(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, level: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, 0.025);
  s.connect(hp).connect(g).connect(out);
  s.start(t);
  s.stop(t + 0.15);
}

/** 曲のひと回りの長さ（秒） */
export function loopSeconds(mood: BgmMood) {
  if (mood === 'piano') return (PIANO.bars.length * 2 * 4 * 60) / PIANO.bpm;
  if (mood === 'guitar') return (GUITAR.bars.length * 2 * 4 * 60) / GUITAR.bpm;
  const s = SONGS[mood];
  return (s.chords.length * s.barsPerChord * s.repeats * 4 * 60) / s.bpm;
}

/** 残響の長さと量 */
function room(mood: BgmMood): { reverbSec: number; wet: number } {
  if (mood === 'piano') return { reverbSec: 3.2, wet: 0.34 };
  if (mood === 'guitar') return { reverbSec: 2, wet: 0.2 };
  return SONGS[mood];
}

/** 楽譜を、時刻 offset から1回分演奏する */
function perform(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, mood: BgmMood, offset: number) {
  if (mood === 'piano') return performPiano(ctx, dry, wet, offset);
  if (mood === 'guitar') return performGuitar(ctx, dry, wet, offset);
  const s = SONGS[mood];
  const beat = 60 / s.bpm;
  const bar = beat * 4;
  const rnd = seeded(`melody-${mood}`);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
  const nd = noise.getChannelData(0);
  const nr = seeded('noise');
  for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;

  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);

  let barIndex = 0;
  let prevMelody = s.root + s.melody.octave;
  for (let rep = 0; rep < s.repeats; rep++) {
    for (const chord of s.chords) {
      const t0 = offset + barIndex * bar;
      const dur = bar * s.barsPerChord;
      // 和音（中くらいの高さに並べる）
      if (s.pad) pad(ctx, wet, chord.map((c) => s.root + c), t0, dur, s.pad);
      // ベース
      // スマホのスピーカーでも聞こえる高さに（低すぎる音は鳴らない）
      const bassMidi = s.root + chord[0] - 12;
      const bassStep = bar / s.bass.perBar;
      for (let k = 0; k < s.barsPerChord * s.bass.perBar; k++) bassNote(ctx, dry, bassMidi, t0 + k * bassStep, bassStep, s.bass.level);
      // 分散和音
      const tones = [...chord, chord[0] + 12, chord[1] + 12].map((c) => s.root + c + s.arp.octave);
      const step = beat / s.arp.perBeat;
      const steps = Math.round(dur / step);
      for (let k = 0; k < steps; k++) {
        const idx = s.arp.pattern[k % s.arp.pattern.length];
        // 2回目のくり返しは少し変化をつける
        const lift = rep % 2 === 1 && k % 8 === 7 ? 12 : 0;
        note(ctx, both, s.arp.voice, tones[idx % tones.length] + lift, t0 + k * step, s.arp.level * (k % s.arp.perBeat === 0 ? 1 : 0.7));
        if (s.shaker) shaker(ctx, dry, noise, t0 + k * step, s.shaker * (k % 2 === 1 ? 1 : 0.55));
      }
      // 旋律：コードに合う音を中心に、なめらかに動く（毎回同じになる乱数で決める）
      const mStep = beat * 2;
      for (let k = 0; k < Math.round(dur / mStep); k++) {
        if (rnd() > s.melody.density + (rep > 0 ? 0.1 : 0)) continue;
        const pool = [...chord.map((c) => ((c % 12) + 12) % 12), ...s.scale];
        const cands: number[] = [];
        for (const pc of pool) for (const oct of [0, 12]) cands.push(s.root + s.melody.octave + pc + oct - 12);
        cands.sort((a, b) => Math.abs(a - prevMelody) - Math.abs(b - prevMelody));
        const m = cands[Math.floor(rnd() * Math.min(4, cands.length))];
        prevMelody = m;
        note(ctx, both, s.melody.voice, m, t0 + k * mStep + (rnd() < 0.3 ? beat : 0), s.melody.level);
      }
      barIndex += s.barsPerChord;
    }
  }
}

// ---------------------------------------------------------------- ピアノソロ

/** 楽譜の1音：拍の位置・音の高さ（MIDI番号）・長さ（拍） */
type N = [beat: number, midi: number, beats: number];

/**
 * ピアノ：ハ長調・ゆっくり。左手は低い分散和音、右手はやさしい旋律。
 * 8小節を2回。2回目は左手が流れるように細かくなり、旋律に高い音の重ねと経過音が入る。
 */
const PIANO = {
  bpm: 72,
  bars: [
    // 和音（左手：根音・5度・10度）と、右手の旋律
    { lh: [36, 43, 52], rh: [[0, 76, 2], [2, 74, 1], [3, 72, 1]] as N[] }, // C
    { lh: [31, 38, 47], rh: [[0, 74, 3], [3, 71, 1]] as N[] }, // G
    { lh: [33, 40, 48], rh: [[0, 72, 2], [2, 76, 1], [3, 72, 1]] as N[] }, // Am
    { lh: [28, 35, 43], rh: [[0, 71, 3], [3, 67, 1]] as N[] }, // Em
    { lh: [29, 36, 45], rh: [[0, 69, 2], [2, 72, 1], [3, 77, 1]] as N[] }, // F
    { lh: [36, 43, 52], rh: [[0, 76, 2], [2, 72, 2]] as N[] }, // C
    { lh: [29, 36, 45], rh: [[0, 74, 1], [1, 72, 1], [2, 69, 2]] as N[] }, // F
    { lh: [31, 38, 47], rh: [[0, 71, 2], [2, 74, 1.5], [3.5, 77, 0.5]] as N[] }, // G7 へ
  ],
};

/**
 * ピアノの1音を計算で作る（同じ高さ・強さの音は1回だけ作って使い回す）。
 * 弦の倍音は少しずつ高めにずれる（本物のピアノの響き）。打った瞬間は明るく、すぐ落ち着いて長く残る。
 * 強く弾いた音（hard）ほど高い倍音が多く、明るい音になる。
 */
function pianoBuffer(ctx: BaseAudioContext, midi: number, hard: boolean): AudioBuffer {
  const rate = ctx.sampleRate;
  const f = hz(midi);
  // 高い音ほど短く、低い音ほど長く響く
  const sustain = Math.max(0.7, 3.2 - (midi - 36) * 0.045);
  const len = Math.floor(rate * Math.min(6, sustain * 2.2 + 0.4));
  const buf = ctx.createBuffer(1, len, rate);
  const y = buf.getChannelData(0);
  const B = 0.00035;
  const amps = [1, 0.55, 0.32, 0.2, 0.12, 0.07, 0.04];
  const rnd = seeded(`piano-${midi}`);
  const partials: { w: number; a: number; tau: number; ph: number }[] = [];
  amps.forEach((a0, k) => {
    const n = k + 1;
    const pf = f * n * Math.sqrt(1 + B * n * n);
    if (pf > rate * 0.45) return;
    const a = a0 * (hard ? 1 : Math.pow(0.62, k)) * (pf > 4000 ? 0.5 : 1);
    const tau = sustain / (1 + k * 0.9);
    // 1本目と2本目の弦をほんの少しずらして、うなり（ふくらみ）を出す
    const cents = n === 1 ? [-1.6, 1.6] : [0];
    for (const c of cents) partials.push({ w: (2 * Math.PI * pf * Math.pow(2, c / 1200)) / rate, a: a / cents.length, tau: tau * rate, ph: rnd() * Math.PI * 2 });
  });
  const atk = Math.floor(rate * 0.004);
  const fast = 0.09 * rate;
  const slow = sustain * rate;
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (const p of partials) v += p.a * Math.exp(-i / p.tau) * Math.sin(p.w * i + p.ph);
    const env = (0.58 * Math.exp(-i / fast) + 0.42 * Math.exp(-i / slow)) * Math.min(1, i / atk);
    y[i] = v * env * 0.6;
  }
  for (let n = 0; n < 1500 && n < len; n++) y[len - 1 - n] *= n / 1500;
  return buf;
}

/** ピアノの1音を鳴らす。鍵盤を離したら（ペダルで少し長めに）静かに消える */
function pianoNote(ctx: BaseAudioContext, out: AudioNode, cache: Map<string, AudioBuffer>, midi: number, at: number, beats: number, beat: number, vel: number) {
  const t = Math.max(0, at); // 弾き方のゆらぎで、曲の頭より前にならないように
  const hard = vel > 0.3;
  const key = `${midi}|${hard}`;
  let buf = cache.get(key);
  if (!buf) cache.set(key, (buf = pianoBuffer(ctx, midi, hard)));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  const off = t + Math.max(beats * beat, 0.25) + beat * 0.6;
  g.gain.setValueAtTime(vel * 1.6, t);
  g.gain.setValueAtTime(vel * 1.6, off);
  g.gain.setTargetAtTime(0, off, 0.25);
  src.connect(g).connect(out);
  src.start(t);
  src.stop(Math.min(t + buf.duration, off + 1.6));
}

function performPiano(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, offset: number) {
  const beat = 60 / PIANO.bpm;
  const bar = beat * 4;
  const rnd = seeded('piano');
  const cache = new Map<string, AudioBuffer>();
  const bus = ctx.createGain();
  bus.gain.value = 0.85;
  // 左手は少し左、右手は少し右から聞こえる
  const pan = (v: number) => {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (!p) return bus;
    p.pan.value = v;
    p.connect(bus);
    return p;
  };
  bus.connect(dry);
  bus.connect(wet);
  const left = pan(-0.18);
  const right = pan(0.15);
  // 人が弾いたような、ほんの少しのずれと強弱
  const human = () => (rnd() - 0.5) * 0.018;
  for (let pass = 0; pass < 2; pass++) {
    PIANO.bars.forEach((b, i) => {
      const t0 = offset + (pass * PIANO.bars.length + i) * bar;
      // スマホのスピーカーでも聞こえるよう、いちばん低い音は1オクターブ上げる
      const [r0, f5, t10] = b.lh;
      const r = r0 + 12;
      // 左手：1回目は「根音・5度・10度・5度」、2回目は8分で流れるように
      const lh: N[] =
        pass === 0
          ? [[0, r, 2], [1, f5 + 12, 1], [2, t10 + 12, 1], [3, f5 + 12, 1]]
          : [[0, r, 2], [0.5, f5 + 12, 0.5], [1, t10 + 12, 0.5], [1.5, r + 12, 0.5], [2, t10 + 12, 0.5], [2.5, f5 + 12, 0.5], [3, t10 + 12, 0.5], [3.5, r + 12, 0.5]];
      for (const [at, m, d] of lh) pianoNote(ctx, left, cache, m, t0 + at * beat + human(), d, beat, (at === 0 ? 0.34 : 0.2) * (0.92 + rnd() * 0.16));
      // 右手：旋律。2回目は1オクターブ上の音をそっと重ね、小節の終わりに経過音を足す
      const phraseEnd = i % 4 === 3;
      b.rh.forEach(([at, m, d], k) => {
        const v = (k === 0 ? 0.42 : 0.34) * (0.92 + rnd() * 0.16) * (phraseEnd ? 0.9 : 1);
        pianoNote(ctx, right, cache, m, t0 + at * beat + human(), d, beat, v);
        if (pass === 1 && k === 0) pianoNote(ctx, right, cache, m + 12, t0 + at * beat + 0.012, d, beat, v * 0.32);
      });
      if (pass === 1 && i % 2 === 0) {
        const last = b.rh[b.rh.length - 1];
        if (last[2] >= 1) pianoNote(ctx, right, cache, last[1] + 2, t0 + (last[0] + 0.5) * beat + human(), 0.5, beat, 0.22);
      }
    });
  }
}

// ---------------------------------------------------------------- アコースティックギター

/**
 * ギター：ト長調・ゆったり。指で弾く「親指でベース、ほかの指で高い弦」の弾き方。
 * 4小節ごとに、最後の小節はやさしくかき鳴らす。2回目は高い弦で旋律がのる。
 * 音は「はじいた弦の振動」を計算で作る（Karplus-Strong という方法）。
 */
const GUITAR = {
  bpm: 84,
  bars: [
    // ギターの押さえ方（低い弦から順）と、2回目の旋律
    { s: [43, 47, 50, 55, 59, 67], mel: [[0, 71, 1.5], [1.5, 74, 2.5]] as N[] }, // G
    { s: [42, 50, 57, 62, 66], mel: [[0, 74, 1], [1, 76, 1], [2, 74, 2]] as N[] }, // D/F#
    { s: [40, 47, 52, 55, 59, 64], mel: [[0, 71, 2], [2, 67, 2]] as N[] }, // Em
    { s: [48, 52, 55, 60, 64], mel: [[0, 72, 1.5], [1.5, 71, 1], [2.5, 69, 1.5]] as N[] }, // C
    { s: [43, 47, 50, 55, 59, 67], mel: [[0, 67, 1], [1, 71, 1], [2, 74, 2]] as N[] }, // G
    { s: [45, 50, 57, 62, 66], mel: [[0, 78, 2], [2, 76, 1], [3, 74, 1]] as N[] }, // D
    { s: [48, 52, 55, 60, 64], mel: [[0, 76, 2], [2, 72, 2]] as N[] }, // C
    { s: [45, 50, 57, 62, 67], mel: [[0, 74, 2], [2, 69, 2]] as N[] }, // Dsus4
  ],
};

/** はじいた弦の音を計算で作る（明るさ 0〜1） */
function pluckBuffer(ctx: BaseAudioContext, midi: number, bright: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const f = hz(midi);
  const len = Math.floor(rate * Math.min(4.5, 2 + (60 - midi) * 0.05 + 1.5));
  const buf = ctx.createBuffer(1, len, rate);
  const y = buf.getChannelData(0);
  // 弦の長さ（遅れ）。平均する処理の 0.5 サンプル分を引き、端数は全域通過フィルタで合わせる
  const L = rate / f - 0.5;
  const D = Math.floor(L);
  const frac = L - D;
  const c = (1 - frac) / (1 + frac);
  const rnd = seeded(`pluck-${midi}-${bright}`);
  // はじいた瞬間の弦の形：雑音を、明るさに合わせてなめらかにする
  const line = new Float32Array(D);
  let lp = 0;
  const a = 0.15 + bright * 0.75;
  for (let i = 0; i < D; i++) {
    lp += a * (rnd() * 2 - 1 - lp);
    line[i] = lp;
  }
  let mean = 0;
  for (const v of line) mean += v / D;
  for (let i = 0; i < D; i++) line[i] -= mean;
  // 高い音ほど早く消える
  const loss = 0.9985 - Math.max(0, midi - 50) * 0.00018;
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  for (let n = 0; n < len; n++) {
    const cur = line[idx];
    const avg = 0.5 * (cur + prev) * loss;
    prev = cur;
    // 全域通過フィルタ（音の高さを正確にする）
    const out = c * avg + apX - c * apY;
    apX = avg;
    apY = out;
    line[idx] = out;
    y[n] = cur;
    idx = (idx + 1) % D;
  }
  // 弾き始めの「カチッ」をやわらげ、最後は静かに消す
  for (let n = 0; n < 64 && n < len; n++) y[n] *= n / 64;
  for (let n = 0; n < 2000 && n < len; n++) y[len - 1 - n] *= n / 2000;
  return buf;
}

function performGuitar(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, offset: number) {
  const beat = 60 / GUITAR.bpm;
  const bar = beat * 4;
  const rnd = seeded('guitar');
  const cache = new Map<string, AudioBuffer>();
  const buf = (m: number, b: number) => {
    const k = `${m}|${b}`;
    let x = cache.get(k);
    if (!x) cache.set(k, (x = pluckBuffer(ctx, m, b)));
    return x;
  };
  // ギターの胴の響き：低めの温かさと、弦のきらめきを少し足す
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 180;
  body.Q.value = 1.1;
  body.gain.value = 4;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 3200;
  air.gain.value = 2.5;
  const bus = ctx.createGain();
  bus.gain.value = 0.95;
  body.connect(air).connect(bus);
  bus.connect(dry);
  bus.connect(wet);
  const pluck = (m: number, at: number, vel: number, bright: number, panV: number) => {
    const t = Math.max(0, at);
    const src = ctx.createBufferSource();
    src.buffer = buf(m, bright);
    const g = ctx.createGain();
    g.gain.value = vel;
    let node: AudioNode = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = panV;
      g.connect(p);
      node = p;
    }
    node.connect(body);
    src.connect(g);
    src.start(t);
  };
  const human = () => (rnd() - 0.5) * 0.02;
  const strPan = (k: number, n: number) => -0.25 + (0.5 * k) / Math.max(1, n - 1);
  for (let pass = 0; pass < 2; pass++) {
    GUITAR.bars.forEach((b, i) => {
      const t0 = offset + (pass * GUITAR.bars.length + i) * bar;
      const st = b.s;
      const n = st.length;
      if (i % 4 === 3 && pass === 0) {
        // やさしくかき鳴らす：下→下→上→下（上は高い弦だけ、弱く）
        const strums: [number, 'down' | 'up', number][] = [[0, 'down', 0.32], [1.5, 'down', 0.22], [2, 'up', 0.16], [3, 'down', 0.24]];
        for (const [at, dir, vel] of strums) {
          const list = dir === 'down' ? st.map((m, k) => [m, k] as const) : st.slice(-4).reverse().map((m, k) => [m, n - 1 - k] as const);
          list.forEach(([m, k], j) => pluck(m, t0 + at * beat + j * (dir === 'down' ? 0.014 : 0.01) + human(), vel * (0.85 + rnd() * 0.3), dir === 'down' ? 0.55 : 0.7, strPan(k, n)));
        }
        return;
      }
      // 指弾き：親指が1拍目と3拍目に低い弦、2拍目と4拍目にもう1本の低い弦。間に高い弦
      const lo = st[0];
      const alt = st[n >= 6 ? 2 : 1];
      const hi = st.slice(-3);
      const seq: [number, number, number, number][] = [
        [0, lo, 0.42, 0],
        [0.5, hi[1], 0.2, n - 2],
        [1, alt, 0.3, n >= 6 ? 2 : 1],
        [1.5, hi[2], 0.2, n - 1],
        [2, lo, 0.36, 0],
        [2.5, hi[0], 0.18, n - 3],
        [3, alt, 0.28, n >= 6 ? 2 : 1],
        [3.5, hi[1], 0.2, n - 2],
      ];
      for (const [at, m, vel, k] of seq) {
        // 2回目は旋律があるので、高い弦を少し控えめに
        const v = k >= n - 3 && pass === 1 ? vel * 0.7 : vel;
        pluck(m, t0 + at * beat + human(), v * (0.88 + rnd() * 0.24), k < 2 ? 0.35 : 0.6, strPan(k, n));
      }
      // 2回目：高い弦で旋律
      if (pass === 1) for (const [at, m] of b.mel) pluck(m, t0 + at * beat + human(), 0.4 * (0.9 + rnd() * 0.2), 0.75, 0.12);
    });
  }
}

const loopCache = new Map<BgmMood, Promise<AudioBuffer>>();

/**
 * 継ぎ目なくくり返せる「ひと回り」を作る。
 * 1回演奏したあとにはみ出した余韻（残響など）を、曲の頭に重ねて戻すと、
 * くり返したときに前の回の余韻が自然につながる。
 * 一度作った曲は端末に保存し、次からはすぐ使えるようにする。
 */
export function renderLoop(mood: BgmMood, _sampleRate = SAMPLE_RATE): Promise<AudioBuffer> {
  let p = loopCache.get(mood);
  if (!p) {
    p = (async () => (await loadSaved(mood)) ?? (await compose(mood)))();
    loopCache.set(mood, p);
    p.catch(() => loopCache.delete(mood));
  }
  return p;
}

/** 曲を作る（少し時間がかかる） */
async function compose(mood: BgmMood): Promise<AudioBuffer> {
  const L = loopSeconds(mood);
  const frames = Math.ceil(L * MUSIC_RATE);
  const tail = Math.ceil((room(mood).reverbSec + 4) * MUSIC_RATE);
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(2, frames + tail, MUSIC_RATE);
  } catch {
    // 古い端末では決まった細かさしか使えないことがある
    return composeAt(mood, 44100);
  }
  return finish(mood, ctx, frames, tail);
}

async function composeAt(mood: BgmMood, rate: number): Promise<AudioBuffer> {
  const L = loopSeconds(mood);
  const frames = Math.ceil(L * rate);
  const tail = Math.ceil((room(mood).reverbSec + 4) * rate);
  return finish(mood, new OfflineAudioContext(2, frames + tail, rate), frames, tail);
}

async function finish(mood: BgmMood, ctx: OfflineAudioContext, frames: number, tail: number): Promise<AudioBuffer> {
  const master = ctx.createGain();
  master.gain.value = 1.7;
  master.connect(ctx.destination);
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  dry.connect(master);
  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx, room(mood).reverbSec);
  const wet = ctx.createGain();
  wet.gain.value = room(mood).wet;
  wet.connect(rev).connect(master);
  perform(ctx, dry, wet, mood, 0);
  const all = await ctx.startRendering();
  const out = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const src = all.getChannelData(ch);
    const dst = new Float32Array(frames);
    dst.set(src.subarray(0, frames));
    // はみ出した余韻を頭に重ねる
    for (let i = 0; i < tail && i < frames; i++) dst[i] += src[frames + i];
    out.copyToChannel(dst, ch);
  }
  void save(mood, out);
  return out;
}

const cacheId = (mood: BgmMood) => `bgm:cache:${mood}:v${MUSIC_VERSION}`;

/** 作った曲を、16ビットの音として端末に保存（容量は1曲あたり数MB） */
async function save(mood: BgmMood, buf: AudioBuffer) {
  try {
    const n = buf.length;
    const pcm = new Int16Array(n * 2);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
      pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
    }
    await db.files.put({ id: cacheId(mood), data: pcm.buffer, type: `audio/pcm;rate=${buf.sampleRate}` });
  } catch {
    /* 保存できなくても、次回また作ればよい */
  }
}

async function loadSaved(mood: BgmMood): Promise<AudioBuffer | null> {
  try {
    const f = await db.files.get(cacheId(mood));
    if (!f) return null;
    const rate = Number(f.type.split('rate=')[1]) || MUSIC_RATE;
    const pcm = new Int16Array(f.data);
    const n = pcm.length / 2;
    const buf = new OfflineAudioContext(2, 1, rate).createBuffer(2, n, rate);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = pcm[i * 2] / 32767;
      r[i] = pcm[i * 2 + 1] / 32767;
    }
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    return buf;
  } catch {
    return null;
  }
}

/** 曲を前もって作っておく（再生前の画面を開いたときに呼ぶ） */
export function warmUp(choice: BgmChoice) {
  if (choice !== 'none' && choice !== 'custom') void renderLoop(choice).catch(() => {});
}

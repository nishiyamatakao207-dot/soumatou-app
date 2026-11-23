/* BGM：アプリの中で作曲・演奏する音楽。
 *
 * 他の人が作った音源（録音・サンプル）は一切使わず、ここに書いた楽譜と音色の設計から
 * ブラウザの音声機能（Web Audio）で音を作る。そのため第三者の著作権にかかわらない。
 *
 * 曲は数十秒の「ひと回り」を作り、継ぎ目なくくり返して使う。
 * （2回分演奏して後半だけ切り出すので、残響もつながって自然にループする） */

import { seeded } from './movie';
import { db } from '../data/db';

export type BgmMood = 'gentle' | 'bright' | 'calm';
export type BgmChoice = 'none' | BgmMood | 'custom';

export const BGM_OPTIONS: { value: BgmChoice; label: string; note: string }[] = [
  { value: 'none', label: 'なし', note: '' },
  { value: 'gentle', label: 'やさしい', note: 'オルゴールのような、ゆったりした曲' },
  { value: 'bright', label: '明るい', note: '軽やかで楽しい曲' },
  { value: 'calm', label: 'しっとり', note: 'ピアノのような、少し切ない曲' },
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

const SONGS: Record<BgmMood, Song> = {
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
  const s = SONGS[mood];
  return (s.chords.length * s.barsPerChord * s.repeats * 4 * 60) / s.bpm;
}

/** 楽譜を、時刻 offset から1回分演奏する */
function perform(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, mood: BgmMood, offset: number) {
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
  const tail = Math.ceil((SONGS[mood].reverbSec + 4) * MUSIC_RATE);
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
  const tail = Math.ceil((SONGS[mood].reverbSec + 4) * rate);
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
  rev.buffer = impulse(ctx, SONGS[mood].reverbSec);
  const wet = ctx.createGain();
  wet.gain.value = SONGS[mood].wet;
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
  if (choice === 'gentle' || choice === 'bright' || choice === 'calm') void renderLoop(choice).catch(() => {});
}

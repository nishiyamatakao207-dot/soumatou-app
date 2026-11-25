/* BGM：アプリの中で作曲・演奏する音楽。
 *
 * 他の人が作った音源（録音・サンプル）は一切使わず、ここに書いた楽譜と音色の設計から
 * ブラウザの音声機能（Web Audio）で音を作る。そのため第三者の著作権にかかわらない。
 *
 * 「ゆったり、やわらかく、ほっとできる」音にするための決まり：
 * - 音色：丸い波形（サイン波・三角波）を中心に、弱めのタッチのピアノ、やわらかい弦（ギター・ハープ）、
 *   ゆっくり立ち上がるパッド・ストリングス。金属的な音・鋭い電子音は使わない
 * - 音の出だしはふわっと、終わりは余韻が残るように
 * - 高い音域を抑える（全体にローパスフィルター＋高音を少し下げる）。旋律も高くなりすぎない音域で
 * - 残響は「暗め」（高い音ほど早く消える）にして、広がりはあってもキンキンしないように
 * - テンポは1分間に60〜72拍
 * - できあがった曲の音量を測って、どの曲も同じくらいの控えめな音量にそろえる
 *
 * 曲は数十秒の「ひと回り」を作り、継ぎ目なくくり返して使う。
 * （はみ出した余韻を曲の頭に重ねて戻すので、くり返してもつながる） */

import { seeded } from './movie';
import { db } from '../data/db';

export type BgmMood = 'calm' | 'warm' | 'dream' | 'nature' | 'waku' | 'koro' | 'pyon';
/** BGM を選ぶ画面での分け方 */
export type BgmGroup = 'calm' | 'pop' | 'other';
export type BgmChoice = 'none' | BgmMood | 'custom';

export const BGM_OPTIONS: { value: BgmChoice; label: string; note: string; group: BgmGroup }[] = [
  { value: 'calm', label: 'やすらぎ', note: 'やさしいタッチのピアノ。静かに思い出を眺めるときに', group: 'calm' },
  { value: 'warm', label: 'ぬくもり', note: 'アコースティックギターの指弾き。家族の日常に', group: 'calm' },
  { value: 'dream', label: 'ゆめごこち', note: 'ふんわり包むパッドとストリングス、ときどきハープ', group: 'calm' },
  { value: 'nature', label: '自然の音', note: '寄せては返す波と小川のせせらぎに、やさしい音楽を重ねて', group: 'calm' },
  { value: 'waku', label: 'わくわく', note: 'ウクレレと手拍子の、明るく楽しい曲', group: 'pop' },
  { value: 'koro', label: 'ころころ', note: 'マリンバと木琴の、はずむようなかわいい曲', group: 'pop' },
  { value: 'pyon', label: 'ぴょんぴょん', note: '口笛と軽いリズムの、楽しいお出かけ風の曲', group: 'pop' },
  { value: 'none', label: 'なし', note: '', group: 'other' },
  { value: 'custom', label: '自分の曲', note: 'スマホの中の音楽ファイル', group: 'other' },
];
export const BGM_GROUPS: { value: BgmGroup; label: string }[] = [
  { value: 'calm', label: 'おちついた' },
  { value: 'pop', label: 'ポップ' },
  { value: 'other', label: 'そのほか' },
];
const MOODS: BgmMood[] = ['calm', 'warm', 'dream', 'nature', 'waku', 'koro', 'pyon'];

/** 前の版の曲の名前を、近い雰囲気の新しい曲に読み替える（設定に残っている値のため） */
export function migrateBgm(v: string): BgmChoice {
  if (v === 'none' || v === 'custom' || (MOODS as string[]).includes(v)) return v as BgmChoice;
  if (v === 'guitar' || v === 'bright') return 'warm';
  return 'calm'; // gentle（オルゴール）・piano など
}

export const SAMPLE_RATE = 48000;
/** 作曲するときの細かさ。高い音を抑えた音楽なので、少し粗くても聞き分けられず、作るのが速くなる */
const MUSIC_RATE = 32000;
/** 曲の作り方を変えたら上げる（端末に保存した曲を作り直すため） */
const MUSIC_VERSION = 5;
/** どの曲もこの音量（RMS）にそろえる。控えめにして、動画の音や声のじゃまをしない */
const TARGET_RMS_DB = -28;
const PEAK_MAX = 0.6;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** 楽譜の1音：拍の位置・音の高さ（MIDI番号）・長さ（拍） */
type N = [beat: number, midi: number, beats: number];

interface Song {
  bpm: number;
  /** 何小節で「ひと回り」か */
  bars: number;
  reverbSec: number;
  wet: number;
  /** 全体のローパスフィルター（Hz） */
  lowpass: number;
}

const SONGS: Record<BgmMood, Song> = {
  calm: { bpm: 66, bars: 16, reverbSec: 3.4, wet: 0.36, lowpass: 3600 },
  warm: { bpm: 72, bars: 16, reverbSec: 2.4, wet: 0.24, lowpass: 3800 },
  dream: { bpm: 60, bars: 16, reverbSec: 4.5, wet: 0.5, lowpass: 3000 },
  nature: { bpm: 60, bars: 16, reverbSec: 4, wet: 0.4, lowpass: 3200 },
  // ポップ：明るく速め。高い音は抑えたまま（少しだけ明るめのフィルター）、残響は短め
  waku: { bpm: 108, bars: 16, reverbSec: 1.6, wet: 0.16, lowpass: 4500 },
  koro: { bpm: 112, bars: 16, reverbSec: 1.8, wet: 0.18, lowpass: 4500 },
  pyon: { bpm: 116, bars: 16, reverbSec: 1.6, wet: 0.16, lowpass: 4500 },
};

/** 曲のひと回りの長さ（秒） */
export const loopSeconds = (mood: BgmMood) => (SONGS[mood].bars * 4 * 60) / SONGS[mood].bpm;

// ---------------------------------------------------------------- 共通の部品

/** 暗めの残響（部屋の響き）の元。高い音ほど早く消えるよう、時間がたつほど強くこもらせる */
function impulse(ctx: BaseAudioContext, sec: number) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rnd = seeded('reverb');
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // こもらせる強さ：始めは 0.5、終わりに向かって 0.04 まで
      const a = 0.5 - 0.46 * Math.sqrt(k);
      lp += a * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - k, 2.2) * 2;
    }
    // 最初の数ミリ秒はなめらかに（「パチッ」とならないように）
    for (let i = 0; i < 200 && i < len; i++) d[i] *= i / 200;
  }
  return buf;
}

/** ゆっくり立ち上がり、ゆっくり消える和音（パッド）。三角波とサイン波を少しずらして重ね、こもらせる */
function pad(ctx: BaseAudioContext, out: AudioNode, midis: number[], t: number, dur: number, level: number, cutoff = 900) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  lp.Q.value = 0.4;
  const g = ctx.createGain();
  const atk = Math.min(2.2, dur / 2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + atk);
  g.gain.setValueAtTime(level, t + dur - 0.3);
  g.gain.linearRampToValueAtTime(0, t + dur + 2.8);
  lp.connect(g).connect(out);
  for (const m of midis) {
    for (const [type, cents] of [
      ['triangle', -5],
      ['sine', 6],
    ] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 3);
    }
  }
}

/**
 * やわらかいストリングス：三角波を3本少しずつずらして重ね、ゆっくりした揺れ（ビブラート）をつける。
 * のこぎり波は使わない（ジーッという鋭い音になるため）
 */
function strings(ctx: BaseAudioContext, out: AudioNode, midis: number[], t: number, dur: number, level: number) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1000, t);
  lp.frequency.linearRampToValueAtTime(1900, t + dur * 0.6);
  lp.frequency.linearRampToValueAtTime(1200, t + dur + 2);
  lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + Math.min(1.8, dur / 2));
  g.gain.setValueAtTime(level, t + dur - 0.2);
  g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
  lp.connect(g).connect(out);
  const vib = ctx.createOscillator();
  vib.frequency.value = 4.6;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 5; // ±5セント
  vib.connect(vibAmt);
  vib.start(t);
  vib.stop(t + dur + 2.5);
  for (const m of midis) {
    for (const cents of [-7, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(m);
      o.detune.value = cents;
      vibAmt.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 2.5);
    }
  }
}

/** やわらかい低音（サイン波）。スマホのスピーカーでも聞こえるよう、低すぎない高さで */
function bass(ctx: BaseAudioContext, out: AudioNode, midi: number, t: number, dur: number, level: number) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = hz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.12);
  g.gain.setTargetAtTime(level * 0.6, t + 0.12, dur / 2);
  g.gain.setTargetAtTime(0, t + dur, 0.4);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 2);
}

/**
 * やわらかいピアノの1音を計算で作る（同じ音は使い回す）。
 * 弱めのタッチ：高い倍音を少なくし、打った瞬間のカツンとした感じを抑え、出だしも少しなだらかに。
 */
function pianoBuffer(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const f = hz(midi);
  const sustain = Math.max(0.9, 3.4 - (midi - 36) * 0.045);
  const len = Math.floor(rate * Math.min(6, sustain * 2.2 + 0.5));
  const buf = ctx.createBuffer(1, len, rate);
  const y = buf.getChannelData(0);
  const B = 0.0003;
  const amps = [1, 0.36, 0.13, 0.06, 0.025];
  const rnd = seeded(`piano-${midi}`);
  const partials: { w: number; a: number; tau: number; ph: number }[] = [];
  amps.forEach((a0, k) => {
    const n = k + 1;
    const pf = f * n * Math.sqrt(1 + B * n * n);
    if (pf > 3500) return; // 高すぎる倍音は入れない
    const tau = sustain / (1 + k * 1.1);
    const cents = n === 1 ? [-1.5, 1.5] : [0];
    for (const c of cents) partials.push({ w: (2 * Math.PI * pf * Math.pow(2, c / 1200)) / rate, a: a0 / cents.length, tau: tau * rate, ph: rnd() * Math.PI * 2 });
  });
  const atk = Math.floor(rate * 0.012); // 12ミリ秒かけて立ち上がる（弱いタッチ）
  const fast = 0.12 * rate;
  const slow = sustain * rate;
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (const p of partials) v += p.a * Math.exp(-i / p.tau) * Math.sin(p.w * i + p.ph);
    const env = (0.35 * Math.exp(-i / fast) + 0.65 * Math.exp(-i / slow)) * Math.min(1, i / atk);
    y[i] = v * env * 0.6;
  }
  for (let n = 0; n < 2000 && n < len; n++) y[len - 1 - n] *= n / 2000;
  return buf;
}

/**
 * はじいた弦の音を計算で作る（Karplus-Strong という方法）。ギター・ハープに使う。
 * bright（0〜1）が小さいほど、丸くやわらかい音。
 */
function pluckBuffer(ctx: BaseAudioContext, midi: number, bright: number, sustainSec = 3.5): AudioBuffer {
  const rate = ctx.sampleRate;
  const f = hz(midi);
  const len = Math.floor(rate * sustainSec);
  const buf = ctx.createBuffer(1, len, rate);
  const y = buf.getChannelData(0);
  const L = rate / f - 0.5;
  const D = Math.floor(L);
  const frac = L - D;
  const c = (1 - frac) / (1 + frac);
  const rnd = seeded(`pluck-${midi}-${bright}`);
  // はじいた瞬間の弦の形：雑音を強くなめらかにして、やわらかい音にする
  const line = new Float32Array(D);
  let lp = 0;
  const a = 0.08 + bright * 0.5;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < D; i++) {
      lp += a * ((pass ? line[i] : rnd() * 2 - 1) - lp);
      line[i] = lp;
    }
  }
  let mean = 0;
  let peak = 0;
  for (const v of line) mean += v / D;
  for (let i = 0; i < D; i++) peak = Math.max(peak, Math.abs((line[i] -= mean)));
  for (let i = 0; i < D; i++) line[i] /= peak || 1;
  // 弦の振動が続くほど、少しずつ丸く（高い音から先に消える）
  const loss = 0.9978 - Math.max(0, midi - 50) * 0.00016;
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  for (let n = 0; n < len; n++) {
    const cur = line[idx];
    const avg = 0.5 * (cur + prev) * loss;
    prev = cur;
    const out = c * avg + apX - c * apY;
    apX = avg;
    apY = out;
    line[idx] = out;
    y[n] = cur;
    idx = (idx + 1) % D;
  }
  // 弾き始めはふわっと（約15ミリ秒）、最後は静かに消す
  const atk = Math.floor(rate * 0.015);
  for (let n = 0; n < atk && n < len; n++) y[n] *= n / atk;
  for (let n = 0; n < 3000 && n < len; n++) y[len - 1 - n] *= n / 3000;
  return buf;
}

/** 計算で作った音（ピアノ・弦）を鳴らす係。同じ音は1回だけ作って使い回す */
function sampler(ctx: BaseAudioContext, make: (midi: number) => AudioBuffer) {
  const cache = new Map<number, AudioBuffer>();
  return (out: AudioNode, midi: number, at: number, vel: number, pan = 0, releaseAt?: number) => {
    const t = Math.max(0, at);
    let buf = cache.get(midi);
    if (!buf) cache.set(midi, (buf = make(midi)));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    if (releaseAt != null) {
      g.gain.setValueAtTime(vel, Math.max(t, releaseAt));
      g.gain.setTargetAtTime(0, Math.max(t, releaseAt), 0.35);
    }
    let node: AudioNode = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(out);
    src.connect(g);
    src.start(t);
    src.stop(Math.min(t + buf.duration, (releaseAt ?? Infinity) + 2));
  };
}

// ---------------------------------------------------------------- やすらぎ（ピアノ）

/** ヘ長調・66拍。左手は低めの分散和音、右手は中くらいの高さのやさしい旋律。うしろにごく小さくパッド */
const CALM = [
  { lh: [41, 48, 57], pad: [53, 57, 60], rh: [[0, 69, 2], [2, 72, 1], [3, 70, 1]] as N[] }, // F
  { lh: [40, 48, 55], pad: [52, 55, 60], rh: [[0, 67, 3], [3, 64, 1]] as N[] }, // C/E
  { lh: [38, 45, 53], pad: [50, 53, 57], rh: [[0, 65, 2], [2, 69, 1], [3, 72, 1]] as N[] }, // Dm
  { lh: [46, 53, 62], pad: [50, 53, 58], rh: [[0, 74, 3], [3, 72, 1]] as N[] }, // B♭
  { lh: [45, 53, 60], pad: [53, 57, 60], rh: [[0, 72, 2], [2, 69, 2]] as N[] }, // F/A
  { lh: [43, 50, 58], pad: [50, 53, 58], rh: [[0, 70, 1], [1, 69, 1], [2, 67, 2]] as N[] }, // Gm7
  { lh: [46, 53, 62], pad: [50, 53, 58], rh: [[0, 65, 1], [1, 67, 1], [2, 69, 2]] as N[] }, // B♭
  { lh: [48, 55, 64], pad: [52, 55, 60], rh: [[0, 67, 3], [3, 64, 1]] as N[] }, // C → F へ戻る
];

function performCalm(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const beat = 60 / SONGS.calm.bpm;
  const bar = beat * 4;
  const rnd = seeded('calm');
  const piano = sampler(ctx, (m) => pianoBuffer(ctx, m));
  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);
  const human = () => (rnd() - 0.5) * 0.02;
  for (let pass = 0; pass < 2; pass++) {
    CALM.forEach((b, i) => {
      const t0 = (pass * CALM.length + i) * bar;
      pad(ctx, wet, b.pad, t0, bar, 0.022, 700);
      const [r, f5, t10] = b.lh;
      // 左手：1回目は「根音・5度・10度・5度」、2回目は8分で流れるように（どちらも弱く）
      const lh: N[] =
        pass === 0
          ? [[0, r, 2], [1, f5, 1], [2, t10, 1], [3, f5, 1]]
          : [[0, r, 2], [0.5, f5, 0.5], [1, t10, 0.5], [1.5, f5, 0.5], [2, t10, 0.5], [2.5, f5, 0.5], [3, t10, 0.5], [3.5, f5, 0.5]];
      for (const [at, m, d] of lh) piano(both, m, t0 + at * beat + human(), (at === 0 ? 0.22 : 0.15) * (0.9 + rnd() * 0.2), -0.15, t0 + (at + d) * beat + beat * 0.8);
      // 右手：旋律（2回目は少し弱く、余韻を多めに）
      for (const [at, m, d] of b.rh) piano(both, m, t0 + at * beat + human(), (pass ? 0.34 : 0.38) * (0.9 + rnd() * 0.2), 0.12, t0 + (at + d) * beat + beat);
    });
  }
}

// ---------------------------------------------------------------- ぬくもり（ギター）

/** ト長調・72拍。親指でベース、ほかの指で高い弦をやさしく弾く。2回目は旋律がのる。うしろにごく小さくパッド */
const WARM = [
  { s: [43, 47, 50, 55, 59], mel: [[0, 71, 1.5], [1.5, 74, 2.5]] as N[] }, // G
  { s: [42, 50, 57, 62], mel: [[0, 74, 1], [1, 72, 1], [2, 69, 2]] as N[] }, // D/F#
  { s: [40, 47, 52, 55, 59], mel: [[0, 71, 2], [2, 67, 2]] as N[] }, // Em
  { s: [48, 52, 55, 60, 64], mel: [[0, 72, 1.5], [1.5, 71, 1], [2.5, 69, 1.5]] as N[] }, // C
  { s: [43, 47, 50, 55, 59], mel: [[0, 67, 1], [1, 71, 1], [2, 74, 2]] as N[] }, // G
  { s: [45, 50, 57, 62, 66], mel: [[0, 74, 2], [2, 71, 1], [3, 69, 1]] as N[] }, // D
  { s: [48, 52, 55, 60, 64], mel: [[0, 72, 2], [2, 67, 2]] as N[] }, // C
  { s: [45, 50, 55, 62, 67], mel: [[0, 69, 2], [2, 67, 2]] as N[] }, // Dsus4 → G へ戻る
];

function performWarm(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const beat = 60 / SONGS.warm.bpm;
  const bar = beat * 4;
  const rnd = seeded('warm');
  // 低い弦は丸く、高い弦も明るすぎないように
  const low = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.18, 4));
  const high = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.32, 3.2));
  // ギターの胴の温かさ（低めの響き）を少し足す
  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 200;
  body.Q.value = 0.9;
  body.gain.value = 3;
  const bus = ctx.createGain();
  body.connect(bus);
  bus.connect(dry);
  bus.connect(wet);
  const human = () => (rnd() - 0.5) * 0.025;
  for (let pass = 0; pass < 2; pass++) {
    WARM.forEach((b, i) => {
      const t0 = (pass * WARM.length + i) * bar;
      const st = b.s;
      const n = st.length;
      pad(ctx, wet, st.slice(-3).map((m) => m - 12 >= 48 ? m - 12 : m), t0, bar, 0.016, 650);
      if (i % 4 === 3 && pass === 0) {
        // 4小節目：かき鳴らさず、ゆっくりと分散させて鳴らす（ポロロン）
        st.forEach((m, k) => (k < 2 ? low : high)(body, m, t0 + k * 0.09 + human(), (k < 2 ? 0.34 : 0.22) * (0.9 + rnd() * 0.2), -0.2 + k * 0.1));
        st.slice(-3).forEach((m, k) => high(body, m, t0 + 2 * beat + k * 0.08 + human(), 0.16, 0.05 + k * 0.08));
        return;
      }
      const lo = st[0];
      const alt = st[Math.min(2, n - 2)];
      const hi = st.slice(-3);
      const seq: [number, number, number, boolean][] = [
        [0, lo, 0.38, true],
        [0.5, hi[1], 0.16, false],
        [1, alt, 0.26, true],
        [1.5, hi[2], 0.15, false],
        [2, lo, 0.32, true],
        [2.5, hi[0], 0.15, false],
        [3, alt, 0.24, true],
        [3.5, hi[1], 0.15, false],
      ];
      for (const [at, m, vel, isLow] of seq) {
        const v = !isLow && pass === 1 ? vel * 0.7 : vel;
        (isLow ? low : high)(body, m, t0 + at * beat + human(), v * (0.88 + rnd() * 0.24), isLow ? -0.2 : 0.15);
      }
      if (pass === 1) for (const [at, m] of b.mel) high(body, m, t0 + at * beat + human(), 0.32 * (0.9 + rnd() * 0.2), 0.05);
    });
  }
}

// ---------------------------------------------------------------- ゆめごこち（パッド・ストリングス・ハープ）

/** ニ長調・60拍。広がりのある和音（7th・9th）を2小節ずつ。ストリングスがゆっくり歌い、ハープがときどき */
const DREAM = [
  { pad: [50, 57, 61, 64], str: [61, 64, 69], bass: 50, harp: [62, 66, 69, 73, 76] }, // Dmaj9
  { pad: [47, 54, 57, 61], str: [61, 62, 66], bass: 47, harp: [59, 62, 66, 69, 73] }, // Bm9
  { pad: [43, 50, 54, 57], str: [59, 62, 66], bass: 43, harp: [62, 66, 67, 71, 74] }, // Gmaj9
  { pad: [45, 52, 57, 59], str: [57, 61, 64], bass: 45, harp: [57, 61, 64, 69, 71] }, // A(add9)
];

function performDream(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, level = 1) {
  const beat = 60 / SONGS.dream.bpm;
  const bar = beat * 4;
  const rnd = seeded('dream');
  const harp = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.22, 4.5));
  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);
  let k = 0;
  for (let rep = 0; rep < 2; rep++) {
    DREAM.forEach((c) => {
      const t0 = k * 2 * bar;
      k++;
      const dur = bar * 2;
      // 和音は中くらいの高さにも重ねる（スマホのスピーカーは低い音が出ないので、低い音だけだと聞こえにくい）
      pad(ctx, both, [...c.pad, ...c.pad.slice(1).map((m) => m + 12)], t0, dur, 0.04 * level, 1500);
      strings(ctx, both, c.str.map((m) => m + 12), t0 + beat * 0.5, dur - beat * 0.5, 0.035 * level);
      bass(ctx, dry, c.bass, t0, dur, 0.04 * level);
      // ハープ：ゆっくり上がっていく分散和音を、ところどころ（2回目は少し多め）
      for (let s = 0; s < 8; s++) {
        if (rnd() > (rep ? 0.6 : 0.45)) continue;
        const m = c.harp[s % c.harp.length];
        harp(both, m + 12 > 81 ? m : m + 12, t0 + s * beat + (rnd() - 0.5) * 0.03, 0.26 * level * (0.85 + rnd() * 0.3), (s % 2 ? 0.25 : -0.25));
      }
    });
  }
}

// ---------------------------------------------------------------- 自然の音（波・小川・森の風＋やさしい音楽）

/**
 * 雑音から自然の音を作る。ひと回りの長さ（L 秒）でちょうど一周するように作り、
 * 終わりを頭になめらかにつなげる（くり返しても継ぎ目がわからないように）。
 */
function loopNoise(ctx: BaseAudioContext, L: number, kind: 'brown' | 'white', seed: string): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(L * rate);
  const xf = Math.floor(rate * 1.5); // つなぎ目を重ねる長さ
  const buf = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = seeded(`${seed}-${ch}`);
    const raw = new Float32Array(n + xf);
    let b = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rnd() * 2 - 1;
      if (kind === 'brown') {
        b = (b + w * 0.02) * 0.998; // 低い「ザー」
        raw[i] = b * 3.5;
      } else raw[i] = w * 0.5;
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = raw[i];
    // 最後の部分（はみ出した分）を、頭に少しずつ重ねる
    for (let i = 0; i < xf; i++) {
      const k = i / xf;
      d[i] = raw[n + i] * (1 - k) + raw[i] * k;
    }
  }
  return buf;
}

function performNature(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const L = loopSeconds('nature');
  const nat = ctx.createGain();
  nat.connect(dry);
  const toWet = ctx.createGain();
  toWet.gain.value = 0.25;
  nat.connect(toWet).connect(wet);

  // 波：低い「ザー」の音量と明るさを、ゆっくり寄せては返す（8秒で1回。ひと回りでちょうど8回）
  const waves = ctx.createBufferSource();
  waves.buffer = loopNoise(ctx, L, 'brown', 'waves');
  const wLp = ctx.createBiquadFilter();
  wLp.type = 'lowpass';
  wLp.Q.value = 0.3;
  const wG = ctx.createGain();
  const period = L / 8;
  const rnd = seeded('waves-shape');
  for (let c = 0; c < 8; c++) {
    const t = c * period;
    const peak = t + period * (0.4 + rnd() * 0.1);
    const lvl = 0.5 + rnd() * 0.25;
    wG.gain.setValueAtTime(0.12, t);
    wG.gain.linearRampToValueAtTime(lvl, peak);
    wG.gain.linearRampToValueAtTime(0.12, t + period);
    wLp.frequency.setValueAtTime(550, t);
    wLp.frequency.linearRampToValueAtTime(1700, peak);
    wLp.frequency.linearRampToValueAtTime(550, t + period);
  }
  waves.connect(wLp).connect(wG).connect(nat);
  waves.start(0);
  waves.stop(L);

  // 小川：細かい「サラサラ」を、こもらせて小さく。音の高さがゆらゆら変わる
  const brook = ctx.createBufferSource();
  brook.buffer = loopNoise(ctx, L, 'white', 'brook');
  const bBp = ctx.createBiquadFilter();
  bBp.type = 'bandpass';
  bBp.Q.value = 0.8;
  const bLp = ctx.createBiquadFilter();
  bLp.type = 'lowpass';
  bLp.frequency.value = 2200;
  const bG = ctx.createGain();
  bG.gain.value = 0.09;
  const r2 = seeded('brook-shape');
  for (let t = 0; t <= L; t += 0.5) bBp.frequency.setValueAtTime(t >= L - 0.5 || t === 0 ? 900 : 650 + r2() * 600, t);
  brook.connect(bBp).connect(bLp).connect(bG).connect(nat);
  brook.start(0);
  brook.stop(L);

  // 森の風：とても低くこもった音が、ゆっくりふくらむ（16秒で1回）
  const wind = ctx.createBufferSource();
  wind.buffer = loopNoise(ctx, L, 'white', 'wind');
  const wiLp = ctx.createBiquadFilter();
  wiLp.type = 'lowpass';
  wiLp.frequency.value = 320;
  const wiG = ctx.createGain();
  for (let c = 0; c < 4; c++) {
    const t = (c * L) / 4;
    wiG.gain.setValueAtTime(0.04, t);
    wiG.gain.linearRampToValueAtTime(0.12, t + L / 8);
    wiG.gain.linearRampToValueAtTime(0.04, t + L / 4);
  }
  wind.connect(wiLp).connect(wiG).connect(nat);
  wind.start(0);
  wind.stop(L);

  // やさしい音楽：ゆめごこちの和音とハープを、小さめに重ねる
  const music = ctx.createGain();
  music.gain.value = 0.85;
  const mDry = ctx.createGain();
  mDry.connect(dry);
  music.connect(mDry);
  performDream(ctx, music, wet, 0.75);
}

// ---------------------------------------------------------------- ポップの曲の部品（木のあたたかい音が中心）

/**
 * マリンバ・木琴：サイン波の基音に、マリンバは4倍、木琴は3倍の音（その楽器らしい響き）を少し足す。
 * 叩いた瞬間も少しだけなだらかに（4ミリ秒）して、カツンとしすぎないように。高い倍音は早く消す
 */
function malletNote(ctx: BaseAudioContext, out: AudioNode, midi: number, at: number, vel: number, kind: 'marimba' | 'xylo' = 'marimba') {
  const t = Math.max(0, at);
  const f = hz(midi);
  const decay = kind === 'marimba' ? Math.max(0.25, 0.9 - (midi - 48) * 0.022) : Math.max(0.18, 0.45 - (midi - 60) * 0.01);
  const parts: [number, number, number][] = kind === 'marimba' ? [[1, 1, 1], [4, 0.18, 0.25]] : [[1, 1, 1], [3, 0.22, 0.3]];
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, decay);
  g.connect(out);
  for (const [mul, amp, dk] of parts) {
    if (f * mul > 4000) continue; // 高すぎる響きは入れない
    const o = ctx.createOscillator();
    o.frequency.value = f * mul;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(amp, t);
    pg.gain.setTargetAtTime(0, t, decay * dk);
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + decay * 6);
  }
}

/** ぽんっと弾むやわらかい低音（三角波を短く） */
function popBass(ctx: BaseAudioContext, out: AudioNode, midi: number, at: number, len: number, vel: number) {
  const t = Math.max(0, at);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = hz(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.01);
  g.gain.setTargetAtTime(vel * 0.4, t + 0.01, 0.12);
  g.gain.setTargetAtTime(0, t + len, 0.06);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.5);
}

/** 打楽器に使う雑音（毎回同じになる） */
function noiseBuf(ctx: BaseAudioContext, sec: number, seed: string) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
  const d = b.getChannelData(0);
  const r = seeded(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}

/** 打楽器：手拍子・シェイカー・やわらかいキック・木の「コン」。どれも高い音を抑えて小さめに */
function percussion(ctx: BaseAudioContext, out: AudioNode) {
  const noise = noiseBuf(ctx, 0.4, 'perc');
  const burst = (t: number, freq: number, q: number, vel: number, decay: number, lp = 2600) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay);
    s.connect(bp).connect(l).connect(g).connect(out);
    s.start(t);
    s.stop(t + decay * 8);
  };
  return {
    /** 手拍子：何人かが少しずれて叩いたように、3回重ねる */
    clap(at: number, vel = 0.22) {
      const t = Math.max(0, at);
      burst(t, 1100, 0.9, vel * 0.7, 0.012, 2000);
      burst(t + 0.011, 1250, 0.9, vel * 0.7, 0.012, 2000);
      burst(t + 0.022, 1150, 0.8, vel, 0.06, 2000);
    },
    shaker(at: number, vel = 0.05) {
      burst(Math.max(0, at), 2300, 1.2, vel, 0.025, 3000);
    },
    /** やわらかいキック（低い「トン」） */
    kick(at: number, vel = 0.35) {
      const t = Math.max(0, at);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.006, 0.07);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.5);
    },
    /** 木の「コン」（ウッドブロックのような、まるい音） */
    wood(at: number, vel = 0.12) {
      malletNote(ctx, out, 79, at, vel, 'xylo');
    },
  };
}

/**
 * 口笛：サイン波に、少し遅れてかかるゆれ（ビブラート）と、息の音をほんの少し。
 * 音と音の間はなめらかにすべらせる（口笛らしく）
 */
function whistlePhrase(ctx: BaseAudioContext, out: AudioNode, notes: { t: number; midi: number; dur: number; vel: number }[]) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  lp.connect(out);
  const breathNoise = noiseBuf(ctx, 2, 'breath');
  let prev: number | null = null;
  for (const n of notes) {
    const t = Math.max(0, n.t);
    const f = hz(n.midi);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const from = prev != null && Math.abs(prev - n.midi) <= 7 ? hz(prev) : f;
    o.frequency.setValueAtTime(from, t);
    o.frequency.setTargetAtTime(f, t, 0.025);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(n.dur > 0.4 ? 14 : 4, t + Math.min(0.3, n.dur));
    vib.connect(vibAmt).connect(o.detune);
    const g = ctx.createGain();
    const end = t + n.dur * 0.92;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(n.vel, t + 0.035);
    g.gain.setValueAtTime(n.vel * 0.9, Math.max(t + 0.04, end - 0.05));
    g.gain.linearRampToValueAtTime(0, end + 0.06);
    o.connect(g).connect(lp);
    // 息の音（とても小さく、音の高さのまわりだけ）
    const b = ctx.createBufferSource();
    b.buffer = breathNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(n.vel * 0.12, t + 0.03);
    bg.gain.linearRampToValueAtTime(0, end + 0.05);
    b.connect(bp).connect(bg).connect(lp);
    for (const x of [o, vib, b] as AudioScheduledSourceNode[]) {
      x.start(t);
      x.stop(end + 0.2);
    }
    prev = n.midi;
  }
}

// ---------------------------------------------------------------- わくわく（ウクレレと手拍子）

/** ハ長調・108拍。ウクレレをやさしくかき鳴らし、2拍目と4拍目に手拍子。旋律もウクレレで */
const WAKU = [
  { uke: [67, 60, 64, 72], root: 48, mel: [[0, 72, 1], [1, 76, 1], [2, 79, 1.5], [3.5, 76, 0.5]] as N[] }, // C
  { uke: [67, 62, 67, 71], root: 43, mel: [[0, 74, 1], [1, 71, 1], [2, 74, 2]] as N[] }, // G
  { uke: [69, 60, 64, 69], root: 45, mel: [[0, 72, 1], [1, 76, 1], [2, 79, 1], [3, 76, 1]] as N[] }, // Am
  { uke: [69, 60, 65, 69], root: 41, mel: [[0, 77, 1.5], [1.5, 76, 0.5], [2, 74, 2]] as N[] }, // F
  { uke: [67, 60, 64, 72], root: 48, mel: [[0, 72, 0.5], [0.5, 74, 0.5], [1, 76, 1], [2, 79, 1], [3, 76, 1]] as N[] }, // C
  { uke: [67, 62, 67, 71], root: 43, mel: [[0, 74, 1], [1, 79, 1], [2, 77, 1], [3, 74, 1]] as N[] }, // G
  { uke: [69, 60, 65, 69], root: 41, mel: [[0, 72, 1], [1, 74, 1], [2, 76, 1], [3, 77, 1]] as N[] }, // F
  { uke: [67, 62, 67, 71], root: 43, mel: [[0, 76, 1], [1, 74, 1], [2, 72, 2]] as N[] }, // G → C
];

function performWaku(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const beat = 60 / SONGS.waku.bpm;
  const bar = beat * 4;
  const rnd = seeded('waku');
  const uke = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.28, 1.8));
  const lead = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.4, 2.2));
  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);
  const perc = percussion(ctx, dry);
  const human = () => (rnd() - 0.5) * 0.012;
  // かき鳴らし：下・下上・上下上（よくある明るいリズム）。上はやさしく、弦を逆の順に
  const strum: [number, 'd' | 'u', number][] = [[0, 'd', 0.2], [1, 'd', 0.15], [1.5, 'u', 0.1], [2.5, 'u', 0.1], [3, 'd', 0.15], [3.5, 'u', 0.1]];
  for (let pass = 0; pass < 2; pass++) {
    WAKU.forEach((b, i) => {
      const t0 = (pass * WAKU.length + i) * bar;
      for (const [at, dir, vel] of strum) {
        const order = dir === 'd' ? b.uke : [...b.uke].reverse();
        order.forEach((m, k) => uke(both, m, t0 + at * beat + k * 0.014 + human(), vel * (0.9 + rnd() * 0.2), -0.2 + k * 0.1));
      }
      popBass(ctx, dry, b.root, t0 + human(), beat * 1.5, 0.22);
      popBass(ctx, dry, b.root + 7, t0 + 2 * beat + human(), beat * 1.5, 0.18);
      perc.clap(t0 + beat + human(), 0.16);
      perc.clap(t0 + 3 * beat + human(), 0.16);
      if (pass === 1) for (let k = 0; k < 8; k++) perc.shaker(t0 + k * beat * 0.5, k % 2 ? 0.04 : 0.025);
      // 旋律：1回目は少し低く、2回目はそのままの高さで
      for (const [at, m] of b.mel) lead(both, pass ? m : m - 12, t0 + at * beat + human(), pass ? 0.34 : 0.4, 0.15);
    });
  }
}

// ---------------------------------------------------------------- ころころ（マリンバと木琴）

/** ヘ長調・112拍。マリンバが「ころころ」と分散和音、木琴が旋律。軽いキックとシェイカー */
const KORO = [
  { ch: [53, 57, 60, 65], root: 41, mel: [[0, 77, 0.5], [0.5, 77, 0.5], [1, 81, 1], [2, 77, 1], [3, 72, 1]] as N[] }, // F
  { ch: [52, 55, 60, 64], root: 48, mel: [[0, 76, 1], [1, 79, 1], [2, 76, 1], [3, 72, 1]] as N[] }, // C
  { ch: [53, 57, 62, 65], root: 50, mel: [[0, 74, 0.5], [0.5, 77, 0.5], [1, 81, 1], [2, 77, 1.5], [3.5, 74, 0.5]] as N[] }, // Dm
  { ch: [53, 58, 62, 65], root: 46, mel: [[0, 74, 1], [1, 77, 1], [2, 70, 2]] as N[] }, // B♭
  { ch: [53, 57, 60, 65], root: 41, mel: [[0, 72, 0.5], [0.5, 74, 0.5], [1, 77, 1], [2, 81, 1], [3, 79, 1]] as N[] }, // F
  { ch: [52, 55, 60, 64], root: 48, mel: [[0, 77, 1], [1, 76, 1], [2, 72, 2]] as N[] }, // C
  { ch: [53, 58, 62, 65], root: 46, mel: [[0, 74, 1], [1, 77, 1], [2, 79, 1], [3, 81, 1]] as N[] }, // B♭
  { ch: [52, 55, 58, 64], root: 48, mel: [[0, 79, 1], [1, 76, 1], [2, 77, 2]] as N[] }, // C7 → F
];

function performKoro(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const beat = 60 / SONGS.koro.bpm;
  const bar = beat * 4;
  const rnd = seeded('koro');
  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);
  // 木琴（旋律）は、高い音をさらに少し抑える
  const xyloLp = ctx.createBiquadFilter();
  xyloLp.type = 'lowpass';
  xyloLp.frequency.value = 2400;
  xyloLp.connect(both);
  const perc = percussion(ctx, dry);
  const human = () => (rnd() - 0.5) * 0.01;
  // マリンバの「ころころ」：8分音符で上がったり下がったり
  const pat = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let pass = 0; pass < 2; pass++) {
    KORO.forEach((b, i) => {
      const t0 = (pass * KORO.length + i) * bar;
      pat.forEach((k, s) => malletNote(ctx, both, b.ch[k] + (pass && s % 4 === 3 ? 12 : 0), t0 + s * beat * 0.5 + human(), (s % 2 ? 0.16 : 0.22) * (0.9 + rnd() * 0.2)));
      malletNote(ctx, dry, b.root, t0 + human(), 0.3);
      malletNote(ctx, dry, b.root + 7, t0 + 2 * beat + human(), 0.24);
      perc.kick(t0, 0.3);
      perc.kick(t0 + 2 * beat, 0.26);
      perc.wood(t0 + beat * 3.5, 0.06);
      for (let k = 0; k < 8; k++) perc.shaker(t0 + k * beat * 0.5, k % 2 ? 0.035 : 0.02);
      for (const [at, m] of b.mel) malletNote(ctx, xyloLp, m, t0 + at * beat + human(), (pass ? 0.3 : 0.26) * (0.9 + rnd() * 0.2), 'xylo');
    });
  }
}

// ---------------------------------------------------------------- ぴょんぴょん（口笛と軽いリズム）

/** ト長調・116拍。口笛の旋律に、ウクレレの軽い刻み・はずむ低音・やわらかいキックと「コン」 */
const PYON = [
  { ch: [62, 67, 71], root: 43, mel: [[0, 74, 0.5], [0.5, 79, 0.5], [1, 79, 1], [2, 81, 0.5], [2.5, 79, 0.5], [3, 74, 1]] as N[] }, // G
  { ch: [64, 67, 71], root: 40, mel: [[0, 76, 1], [1, 79, 0.5], [1.5, 76, 0.5], [2, 71, 2]] as N[] }, // Em
  { ch: [64, 67, 72], root: 48, mel: [[0, 72, 0.5], [0.5, 76, 0.5], [1, 79, 1], [2, 81, 1], [3, 79, 1]] as N[] }, // C
  { ch: [62, 66, 69], root: 50, mel: [[0, 78, 1.5], [1.5, 76, 0.5], [2, 74, 2]] as N[] }, // D
  { ch: [62, 67, 71], root: 43, mel: [[0, 74, 0.5], [0.5, 79, 0.5], [1, 83, 1], [2, 81, 0.5], [2.5, 79, 0.5], [3, 76, 1]] as N[] }, // G
  { ch: [64, 67, 71], root: 40, mel: [[0, 79, 1], [1, 76, 1], [2, 74, 1], [3, 71, 1]] as N[] }, // Em
  { ch: [64, 67, 72], root: 48, mel: [[0, 72, 1], [1, 76, 1], [2, 81, 1], [3, 79, 1]] as N[] }, // C
  { ch: [62, 66, 72], root: 50, mel: [[0, 78, 1], [1, 81, 1], [2, 79, 2]] as N[] }, // D7 → G
];

function performPyon(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode) {
  const beat = 60 / SONGS.pyon.bpm;
  const bar = beat * 4;
  const rnd = seeded('pyon');
  const chop = sampler(ctx, (m) => pluckBuffer(ctx, m, 0.3, 0.9));
  const both = ctx.createGain();
  both.connect(dry);
  both.connect(wet);
  const perc = percussion(ctx, dry);
  const human = () => (rnd() - 0.5) * 0.01;
  const notes: { t: number; midi: number; dur: number; vel: number }[] = [];
  for (let pass = 0; pass < 2; pass++) {
    PYON.forEach((b, i) => {
      const t0 = (pass * PYON.length + i) * bar;
      // 裏拍で、ウクレレを短く「チャッ」と（スキップしているような弾み）
      for (const at of [0.5, 1.5, 2.5, 3.5]) b.ch.forEach((m, k) => chop(both, m, t0 + at * beat + k * 0.01 + human(), 0.13, 0, t0 + (at + 0.35) * beat));
      // はずむ低音：1・2・3・4拍に、根音と5度を行ったり来たり
      [0, 7, 12, 7].forEach((d, k) => popBass(ctx, dry, b.root + d, t0 + k * beat + human(), beat * 0.6, k % 2 ? 0.16 : 0.2));
      perc.kick(t0, 0.28);
      perc.kick(t0 + 2 * beat, 0.24);
      perc.wood(t0 + beat, 0.07);
      perc.wood(t0 + 3 * beat, 0.07);
      if (pass === 1) for (let k = 0; k < 8; k++) perc.shaker(t0 + k * beat * 0.5, k % 2 ? 0.03 : 0.018);
      for (const [at, m, d] of b.mel) notes.push({ t: t0 + at * beat + human(), midi: m, dur: d * beat, vel: pass ? 0.13 : 0.12 });
    });
  }
  whistlePhrase(ctx, both, notes);
}

// ---------------------------------------------------------------- 曲を作る

function perform(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, mood: BgmMood) {
  if (mood === 'calm') return performCalm(ctx, dry, wet);
  if (mood === 'warm') return performWarm(ctx, dry, wet);
  if (mood === 'dream') return performDream(ctx, dry, wet);
  if (mood === 'nature') return performNature(ctx, dry, wet);
  if (mood === 'waku') return performWaku(ctx, dry, wet);
  if (mood === 'koro') return performKoro(ctx, dry, wet);
  return performPyon(ctx, dry, wet);
}

const loopCache = new Map<BgmMood, Promise<AudioBuffer>>();

/**
 * 継ぎ目なくくり返せる「ひと回り」を作る。
 * 一度作った曲は端末に保存し、次からはすぐ使えるようにする。
 */
export function renderLoop(mood: BgmMood, _sampleRate = SAMPLE_RATE): Promise<AudioBuffer> {
  void cleanupOld();
  let p = loopCache.get(mood);
  if (!p) {
    p = (async () => (await loadSaved(mood)) ?? (await compose(mood)))();
    loopCache.set(mood, p);
    p.catch(() => loopCache.delete(mood));
  }
  return p;
}

async function compose(mood: BgmMood): Promise<AudioBuffer> {
  for (const rate of [MUSIC_RATE, 44100]) {
    try {
      const L = loopSeconds(mood);
      const frames = Math.ceil(L * rate);
      const tail = Math.ceil((SONGS[mood].reverbSec + 5) * rate);
      return await finish(mood, new OfflineAudioContext(2, frames + tail, rate), frames, tail);
    } catch (e) {
      // 古い端末では決まった細かさしか使えないことがある
      if (rate === 44100) throw e;
    }
  }
  throw new Error('BGMを作れませんでした');
}

async function finish(mood: BgmMood, ctx: OfflineAudioContext, frames: number, tail: number): Promise<AudioBuffer> {
  const song = SONGS[mood];
  // 仕上げ：高い音域を抑える（ローパス）＋高音をさらに少し下げる
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = song.lowpass;
  lp.Q.value = 0.5;
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 2500;
  shelf.gain.value = -4;
  // こもりすぎないよう、ごく低い音（スマホでは鳴らずに濁るだけ）は少し整理する
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 55;
  const master = ctx.createGain();
  master.connect(hp).connect(lp).connect(shelf).connect(ctx.destination);
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  dry.connect(master);
  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx, song.reverbSec);
  const wet = ctx.createGain();
  wet.gain.value = song.wet;
  wet.connect(rev).connect(master);
  perform(ctx, dry, wet, mood);
  const all = await ctx.startRendering();
  const out = ctx.createBuffer(2, frames, ctx.sampleRate);
  const chans: Float32Array<ArrayBuffer>[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const src = all.getChannelData(ch);
    const dst = new Float32Array(frames);
    dst.set(src.subarray(0, frames));
    // はみ出した余韻を頭に重ねる
    for (let i = 0; i < tail && i < frames; i++) dst[i] += src[frames + i];
    chans.push(dst);
  }
  // 音量をそろえる：耳とスマホのスピーカーに聞こえやすい音域（だいたい300Hzより上）の大きさで測り、
  // どの曲も同じ控えめな大きさにする（低い音ばかりの曲が、スマホで小さく聞こえないように）。ピークも超えないように
  const rate = ctx.sampleRate;
  const a = Math.exp((-2 * Math.PI * 300) / rate);
  let sum = 0;
  let peak = 0;
  let x1 = 0;
  let y1 = 0;
  let y2p = 0;
  let y2 = 0;
  for (let i = 0; i < frames; i++) {
    const x = (chans[0][i] + chans[1][i]) / 2;
    peak = Math.max(peak, Math.abs(chans[0][i]), Math.abs(chans[1][i]));
    // 2回かける「低い音を減らすフィルター」
    y1 = a * (y1 + x - x1);
    x1 = x;
    y2 = a * (y2 + y1 - y2p);
    y2p = y1;
    sum += y2 * y2;
  }
  const rms = Math.sqrt(sum / frames) || 1;
  const gain = Math.min(Math.pow(10, TARGET_RMS_DB / 20) / rms, PEAK_MAX / (peak || 1));
  chans.forEach((d, ch) => {
    for (let i = 0; i < d.length; i++) d[i] *= gain;
    out.copyToChannel(d, ch);
  });
  void save(mood, out);
  return out;
}

// ---------------------------------------------------------------- 端末に保存

const cacheId = (mood: BgmMood) => `bgm:cache:${mood}:v${MUSIC_VERSION}`;

let cleaned = false;
/** 前の版の曲（もう使わない）を端末から消す */
async function cleanupOld() {
  if (cleaned) return;
  cleaned = true;
  try {
    const keep = new Set(MOODS.map(cacheId));
    const old = (await db.files.where('id').startsWith('bgm:cache:').primaryKeys()).filter((k) => !keep.has(k as string));
    if (old.length) await db.files.bulkDelete(old);
  } catch {
    /* 消せなくても困らない */
  }
}

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

import { db } from '../data/db';
import { loadFile } from '../data/repository';
import { renderLoop, SAMPLE_RATE, type BgmChoice } from './music';

/* BGMの音源を用意し、再生画面で鳴らす */

export const CUSTOM_BGM_ID = 'bgm:custom';
/** BGMの音量（動画の音より少し控えめ） */
export const BGM_VOLUME = 0.75;
/** 音のある動画を流している間の BGM の音量（元の何倍か） */
export const DUCK = 0.3;

/** 自分の音楽ファイルを、この端末の中に保存する */
export async function saveCustomBgm(file: File): Promise<void> {
  // 読めるかどうか先に確かめる（読めない形式なら保存しない）
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  await ctx.decodeAudioData(data.slice(0));
  await db.files.put({ id: CUSTOM_BGM_ID, data, type: file.type || 'audio/mpeg' });
}

/** BGM の音（くり返して使う）。なしのときは null */
export async function bgmBuffer(choice: BgmChoice, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  if (choice === 'none') return null;
  if (choice === 'custom') {
    const blob = await loadFile(CUSTOM_BGM_ID);
    if (!blob) return null;
    return ctx.decodeAudioData(await blob.arrayBuffer());
  }
  return renderLoop(choice, SAMPLE_RATE);
}

/**
 * iPhone の消音スイッチ（マナーモード）対策。
 * アプリが作った音（Web Audio）は消音スイッチで消えてしまうが、
 * 普通の音声プレーヤー（<audio>）で音を流している間は「音楽の再生」扱いになり、消音スイッチ中でも聞こえる。
 * そこで、タップしたその場で「無音の音声」をくり返し流しておく。
 */
let keepAlive: HTMLAudioElement | null = null;
let keepAliveUsers = 0;

function silentWavUrl(): string {
  const rate = 8000;
  const n = rate / 2; // 0.5秒
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}

/** タップしたその場で呼ぶ：音が出るように準備する */
export function unlockAudioOutput() {
  preferPlaybackAudio();
  try {
    if (!keepAlive) {
      keepAlive = new Audio(silentWavUrl());
      keepAlive.loop = true;
      keepAlive.setAttribute('playsinline', '');
      keepAlive.preload = 'auto';
    }
    keepAliveUsers++;
    void keepAlive.play().catch(() => {});
  } catch {
    /* 音声プレーヤーが使えない環境 */
  }
}

export function releaseAudioOutput() {
  keepAliveUsers = Math.max(0, keepAliveUsers - 1);
  if (keepAliveUsers === 0) keepAlive?.pause();
}

/**
 * マイクを使う前に呼ぶ：音楽用の設定（再生だけのモード）をやめ、無音の音声も止める。
 * iPhone は「再生だけのモード」のままだと、マイクを渡してくれないことがある。
 */
export function prepareForMicrophone(): string {
  try {
    keepAlive?.pause();
  } catch {
    /* 止まっている */
  }
  keepAliveUsers = 0;
  const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!s) return 'audioSessionなし';
  const before = s.type;
  // 「マイク用」を自分で決めず、ブラウザに任せる（auto）。自分で決めても、2回目以降に
  // 「マイクの音が止められている（Source is muted）」となるのは直らなかったため
  try {
    s.type = 'auto';
  } catch {
    /* 変えられない */
  }
  return `audioSession ${before}→${s.type}`;
}

/** iPhone のマナーモード（消音スイッチ）中でも音が出るようにお願いする（対応している iOS のみ） */
export function preferPlaybackAudio() {
  const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (s) {
    try {
      s.type = 'playback';
    } catch {
      /* 非対応 */
    }
  }
}

/** 動画を実時間で録画するときに、音を流すための AudioContext（ボタンを押したその場で呼ぶ） */
export function createExportAudioContext(): AudioContext | undefined {
  try {
    unlockAudioOutput();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC({ sampleRate: SAMPLE_RATE });
    void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return undefined;
  }
}

/**
 * 再生画面の BGM。
 * iPhone では、ボタンを押したその場で音を「起こす」必要があるので、
 * new したらすぐ（同じタップの中で）unlock() を呼ぶ。
 */
const players = new Set<BgmPlayer>();

/**
 * 声で入力する前に呼ぶ：鳴っている BGM・動画・音をすべて止める。
 * 再生画面（今日のひとめぐりなど）にも知らせて、一時停止にしてもらう。止めた数を返す。
 */
export function pauseAllMedia(): number {
  let n = 0;
  for (const p of players) if (p.state === 'running') (p.pause(), n++);
  document.querySelectorAll('video, audio').forEach((m) => {
    const el = m as HTMLMediaElement;
    if (!el.paused) (el.pause(), n++);
  });
  window.dispatchEvent(new Event('meguru-pause-media'));
  return n;
}

export class BgmPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private source?: AudioBufferSourceNode;
  private muted = false;
  private ducked = false;
  private stopped = false;

  /** 最後に失敗した理由（画面に出す用） */
  lastError = '';

  constructor() {
    unlockAudioOutput();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    players.add(this);
  }

  unlock() {
    void this.ctx.resume().catch(() => {});
  }

  /** 曲を最初から流す（ふわっと大きくなる） */
  async play(choice: BgmChoice): Promise<boolean> {
    this.source?.stop();
    this.source = undefined;
    let buf: AudioBuffer | null = null;
    try {
      buf = await bgmBuffer(choice, this.ctx);
      if (!buf) this.lastError = choice === 'custom' ? '自分の曲が見つかりません' : '曲がありません';
    } catch (e) {
      this.lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    if (!buf || this.stopped) return false;
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.level(), now + 2);
    src.start(now);
    this.source = src;
    return true;
  }

  private level() {
    return this.muted ? 0 : BGM_VOLUME * (this.ducked ? DUCK : 1);
  }

  private apply(sec = 0.4) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(this.level(), now, sec / 3);
  }

  pause() {
    void this.ctx.suspend().catch(() => {});
  }
  resume() {
    void this.ctx.resume().catch(() => {});
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.apply(0.2);
  }
  /** 音のある動画の間は BGM を小さく */
  duck(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.apply(0.6);
  }
  /** だんだん小さくして止める */
  fadeOut(sec = 2.5) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + sec);
  }
  /** 音が鳴る状態か（画面に出す用） */
  get state() {
    return this.ctx.state;
  }

  dispose() {
    players.delete(this);
    if (!this.stopped) releaseAudioOutput();
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      /* すでに止まっている */
    }
    void this.ctx.close().catch(() => {});
  }
}

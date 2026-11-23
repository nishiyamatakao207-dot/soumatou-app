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
    preferPlaybackAudio();
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
export class BgmPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private source?: AudioBufferSourceNode;
  private muted = false;
  private ducked = false;
  private stopped = false;

  constructor() {
    preferPlaybackAudio();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
  }

  unlock() {
    void this.ctx.resume().catch(() => {});
  }

  /** 曲を最初から流す（ふわっと大きくなる） */
  async play(choice: BgmChoice): Promise<boolean> {
    this.source?.stop();
    this.source = undefined;
    const buf = await bgmBuffer(choice, this.ctx).catch(() => null);
    if (!buf || this.stopped) return false;
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
  dispose() {
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      /* すでに止まっている */
    }
    void this.ctx.close().catch(() => {});
  }
}

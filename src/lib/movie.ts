import type { DatedItem } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';

/* 思い出ムービーの「設計図」。画面での再生と、動画の書き出しで共通に使う。
 * ここを変えると、再生と書き出しの両方の見た目・タイミングが変わる。 */

export const FADE_MS = 1800; // フェードの長さ（前後の写真が重なる時間）
export const PHOTO_MS = 7000; // 写真1枚の表示時間の標準（次の写真が出始めるまでの間隔）
export const VIDEO_MAX_MS = 20000; // 動画はここまでで次へ
export const BG_FADE_MS = 2600; // 背景の色が移り変わる時間
export const COMMENT_SPACE = 150; // 写真の下にコメント用にあける高さ
export const TOP_SPACE = 118; // 上のボタンと日付の分
export const DRIFT = 16; // 漂う距離（px）
export const COMMENT_DELAY_MS = 900; // 写真が出てからコメントが出始めるまで
export const COMMENT_FADE_MS = 1600;

export interface Slide {
  key: string;
  memory: Memory;
  media?: MediaItem;
  comment: string;
  /** この1枚の日付 */
  date: number;
}

/** 日付順の写真・動画を、再生する1枚ずつのスライドにする */
export function buildSlides(items: DatedItem[]): Slide[] {
  const firstOfMemory = new Set<string>();
  return items.map((it) => {
    const first = !firstOfMemory.has(it.memory.id);
    firstOfMemory.add(it.memory.id);
    return it.media
      ? { key: it.media.id, memory: it.memory, media: it.media, date: it.date, comment: it.media.caption || (first ? it.memory.text : '') }
      : { key: it.memory.id, memory: it.memory, date: it.date, comment: it.memory.text };
  });
}

/** 写真1枚の表示時間の設定（設定画面・再生中のメニュー・書き出しで同じものを使う） */
export interface PhotoTiming {
  /** 1枚の表示時間（秒）。3〜15 */
  sec: number;
  /** 字幕が長い写真は、読み切れるよう自動で延ばす */
  autoLong: boolean;
}
export const DEFAULT_TIMING: PhotoTiming = { sec: PHOTO_MS / 1000, autoLong: true };
export const PHOTO_SEC_MIN = 3;
export const PHOTO_SEC_MAX = 15;

/** 字幕1文字を読むのにかける時間（ゆっくりめ：1秒に約7文字） */
const READ_MS_PER_CHAR = 150;
/** 字幕を読み切るのに必要な、写真の間隔（字幕が出るまでの待ち＋文字数分＋読み終えてからの余韻） */
export function readMs(comment: string): number {
  const n = [...comment.replace(/\s/g, '')].length;
  return n ? COMMENT_DELAY_MS + COMMENT_FADE_MS / 2 + n * READ_MS_PER_CHAR + 1200 : 0;
}
/** 自動で延ばすのは最大でここまで（長すぎる字幕で止まって見えないように） */
const MAX_EXTRA_MS = 10000;

/** 写真と次の写真の間隔（ミリ秒）。字幕が長いときは自動で延ばす */
export function photoIntervalMs(slide: Slide | undefined, t: PhotoTiming = DEFAULT_TIMING): number {
  const base = Math.min(PHOTO_SEC_MAX, Math.max(PHOTO_SEC_MIN, t.sec)) * 1000;
  if (!t.autoLong || !slide?.comment) return base;
  return Math.min(base + MAX_EXTRA_MS, Math.max(base, readMs(slide.comment)));
}

/** 写真の表示時間。フェードで重なる分を足して、写真と写真の間隔がちょうど設定の秒数になるようにする */
export const photoDwell = (slide?: Slide, t: PhotoTiming = DEFAULT_TIMING) => photoIntervalMs(slide, t) + FADE_MS;

/** 漂う動き（CSS の float アニメーション）の長さ */
export const driftMs = (slide: Slide, t: PhotoTiming = DEFAULT_TIMING) =>
  (slide.media?.kind === 'video' ? VIDEO_MAX_MS : photoDwell(slide, t)) + FADE_MS * 2;

/** スライドごとに毎回同じになる乱数（戻っても同じ位置に出る） */
export function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface Placement {
  d: number; // 直径
  x: number; // 円の左上
  y: number;
  dx: number; // 漂う向き
  dy: number;
  commentLeft: number; // 円の左端から見たコメントの位置
  commentWidth: number;
}

/** 写真が画面からはみ出さず、下のコメントとも重ならない範囲で位置を決める */
export function place(key: string, vw: number, vh: number): Placement {
  const rnd = seeded(key);
  const margin = 8 + DRIFT; // 漂っても画面の端に当たらない余白
  // 円のいちばん外側（約8%）はほぼ透明なので、そこだけは画面の外に出てもよい
  const RIM = 0.08;
  const top = TOP_SPACE;
  const bottom = vh - 16;
  const fitW = (vw - margin * 2) / (1 - RIM * 2);
  const fitH = (bottom - top - COMMENT_SPACE) / (1 - RIM);
  const maxD = Math.max(160, Math.min(fitW, fitH));
  const d = Math.round(maxD * (0.88 + rnd() * 0.12));
  const rim = d * RIM;
  const xMin = margin - rim;
  const xMax = Math.max(xMin, vw - margin - d + rim);
  const yMin = top - rim;
  const yMax = Math.max(yMin, bottom - COMMENT_SPACE - d + rim);
  const x = xMin + (xMax - xMin) * rnd();
  const y = yMin + (yMax - yMin) * rnd();
  const ang = rnd() * Math.PI * 2;
  const commentWidth = Math.min(vw - 32, 520);
  const cx = x + d / 2;
  const left = Math.min(Math.max(cx - commentWidth / 2, 16), vw - 16 - commentWidth);
  return { d, x, y, dx: Math.cos(ang) * DRIFT, dy: Math.sin(ang) * DRIFT, commentLeft: left - x, commentWidth };
}

/** 光の粒（40個）の大きさ・位置（%）・動く速さ（秒）。毎回同じ配置になるよう固定の乱数で決める */
export interface Mote {
  size: number;
  left: number;
  top: number;
  dur: number;
  delay: number;
}
export const MOTES: Mote[] = (() => {
  const rnd = seeded('motes');
  return Array.from({ length: 40 }, () => ({
    size: 6 + Math.round(rnd() * rnd() * 34), // 小さい粒を多めに
    left: rnd() * 104 - 2,
    top: rnd() * 104 - 2,
    dur: 11 + rnd() * 12,
    delay: rnd() * 20,
  }));
})();

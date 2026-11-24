import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { loadFile, thumbKey } from '../data/repository';
import { CAPTION_TOP, drawShaped, type PhotoShape } from './shape';
import { formatDot } from './format';
import {
  BG_FADE_MS,
  COMMENT_DELAY_MS,
  COMMENT_FADE_MS,
  FADE_MS,
  MOTES,
  VIDEO_MAX_MS,
  driftMs,
  photoDwell,
  place,
  type Placement,
  type Slide,
} from './movie';
import { DEFAULT_PALETTE, extractPalette, type Palette } from './palette';
import { BGM_VOLUME, DUCK, bgmBuffer } from './bgm';
import { SAMPLE_RATE, type BgmChoice } from './music';
import { SEASON_TINT, particles, seasonOf, type Particle, type Season } from './season';

/* 思い出ムービーを動画ファイル（MP4）にする。
 *
 * 画面の再生と同じ見た目を、見えないキャンバスに1コマずつ描いて動画にする。
 * 書き出し方は2つ：
 * - きれいに書き出す（標準）：スマホの動画変換機能（WebCodecs のハードウェア変換）で1コマずつ変換する。
 *   Mediabunny というライブラリで MP4（H.264＋AAC）にする。対応していない古い端末では下の方法に切り替える。
 * - 速い書き出し：画面の再生と同じように動かしながら録画する（MediaRecorder）。動画の長さとほぼ同じ時間で終わる。
 *
 * 速くするための工夫：
 * - 写真ごとのぼかし背景・切り抜き・字幕・光の粒の絵は、1回だけ作って使い回す
 * - 動画素材は1コマずつ探し直さず（シークせず）、頭から順番に取り出す（VideoDecoder）
 * - かかった時間を種類ごとに記録して、残り時間の見積もりと、遅いときの原因調べに使う */

/** 動画の論理サイズ（スマホの画面と同じくらい）。実際の画素数は SCALE 倍 */
const LW = 360;
const LH = 640;
const FPS = 30;
const OPEN_MS = 700; // 最初の黒からのフェード
const TAIL_MS = 600; // 最後の余韻

export type ExportQuality = 'standard' | 'high';
export type ExportMode = 'encode' | 'realtime';

/** 画質ごとの大きさ（標準 720×1280、高画質 1080×1920）と、1秒あたりのデータ量 */
const QUALITY: Record<ExportQuality, { scale: number; bitrate: number; label: string }> = {
  standard: { scale: 2, bitrate: 3_000_000, label: '標準（720p）' },
  high: { scale: 3, bitrate: 6_000_000, label: '高画質（1080p）' },
};
let SCALE = 2;
let W = LW * SCALE;
let H = LH * SCALE;
let BITRATE = QUALITY.standard.bitrate;
function setQuality(q: ExportQuality) {
  SCALE = QUALITY[q].scale;
  W = LW * SCALE;
  H = LH * SCALE;
  BITRATE = QUALITY[q].bitrate;
}

export interface ExportProgress {
  /** 0〜1（なめらかに増える） */
  ratio: number;
  /** 残り時間の目安（秒）。計算中は undefined */
  remainingSec?: number;
  /** 今していること（画面に出す） */
  label?: string;
}

export interface ExportStats {
  method: string;
  quality: string;
  frames: number;
  seconds: number;
  /** 種類ごとにかかった時間（秒） */
  parts: Record<string, number>;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  /** 音（BGM・動画の音）が入ったか */
  audioIncluded: boolean;
  /** 高画質を選んだが、この端末では標準画質で書き出した */
  downgraded?: boolean;
  stats: ExportStats;
}

export interface ExportOptions {
  slides: Slide[];
  showDate: boolean;
  bgm: BgmChoice;
  /** 写真の形（設定で選んだもの） */
  shape: PhotoShape;
  quality: ExportQuality;
  mode: ExportMode;
  /**
   * 再生しながら録画するときに使う音の出口。iPhone ではボタンを押したその場で作る必要があるので、
   * 画面側で createExportAudioContext() を呼んで渡す。
   */
  audioCtx?: AudioContext;
  onProgress: (p: ExportProgress) => void;
  signal: AbortSignal;
}

// ---------------------------------------------------------------- かかった時間の記録

class Prof {
  parts: Record<string, number> = {};
  private t = performance.now();
  /** 前回からの時間を label に足す */
  lap(label: string) {
    const now = performance.now();
    this.parts[label] = (this.parts[label] ?? 0) + (now - this.t);
    this.t = now;
  }
  mark() {
    this.t = performance.now();
  }
}

// ---------------------------------------------------------------- タイミング

interface Timing {
  start: number[];
  dwell: number[];
  total: number;
}

/** 再生画面と同じ規則で、各スライドの始まりと長さを決める */
function schedule(slides: Slide[], videoSec: Map<number, number>): Timing {
  const start: number[] = [];
  const dwell: number[] = [];
  let t = OPEN_MS;
  slides.forEach((s, i) => {
    const sec = videoSec.get(i);
    const d = s.media?.kind === 'video' ? (sec ? Math.min(VIDEO_MAX_MS, sec * 1000 + FADE_MS) : VIDEO_MAX_MS) : photoDwell();
    start.push(t);
    dwell.push(d);
    t += d - FADE_MS; // 次の写真は、前の写真のフェードと重ねて出る
  });
  const last = slides.length - 1;
  return { start, dwell, total: start[last] + dwell[last] + FADE_MS + TAIL_MS };
}

/** 秒数の目安（書き出す前の画面で使う） */
export function estimateDurationSec(slides: Slide[]): number {
  if (!slides.length) return 0;
  return Math.round(schedule(slides, new Map()).total / 1000);
}

// ---------------------------------------------------------------- 動きの計算（CSS と同じ）

/** CSS の cubic-bezier を計算する */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / s;
    }
    return at(Math.min(1, Math.max(0, t)), y1, y2);
  };
}
const ease = bezier(0.25, 0.1, 0.25, 1);
const easeInOut = bezier(0.42, 0, 0.58, 1);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;


// ---------------------------------------------------------------- 素材の準備

/** 動画素材のコマを、頭から順番に取り出す係（1コマずつ探し直さない） */
interface FrameStream {
  /** 次のコマ（同じ時刻が続くときは null のことがある） */
  next(): Promise<CanvasImageSource | null>;
  close(): void;
}

interface Prepared {
  placement: Placement;
  palette: Palette;
  /** ぼかした写真などで作った背景（全画面） */
  bg: HTMLCanvasElement;
  /** 選んだ形に切り抜いた写真（写真のとき） */
  shaped?: HTMLCanvasElement;
  /** 写真のない記録・見つからない写真：丸い淡い光と文字 */
  textCircle?: HTMLCanvasElement;
  /** 字幕（日付とコメント）を、影つきで先に描いたもの */
  caption?: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
  /** 動画：順番にコマを取り出す（きれいに書き出すとき） */
  frames?: FrameStream;
  /** 動画：再生しながら録画するとき、または順番に取り出せない端末 */
  video?: HTMLVideoElement;
  videoStarted?: boolean;
  /** 動画のコマを形に切り抜くための作業用キャンバスと、最後に描いたコマ */
  videoCanvas?: HTMLCanvasElement;
  hasFrame?: boolean;
  missing: boolean;
  dispose(): void;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function toBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
const sizeOf = (img: ImageBitmap | HTMLImageElement) =>
  'naturalWidth' in img ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];

/**
 * 写真を強くぼかした画像（背景用）。小さめのキャンバスでぼかしてから引き伸ばす。
 * ぼかし機能（canvas の filter）がない端末では、縮小して少しずつずらして重ねる方法でぼかす。
 */
function blurred(photo: CanvasImageSource, pw: number, ph: number): HTMLCanvasElement {
  const w = 90;
  const h = Math.round((w * H) / W);
  const s = Math.max(w / pw, h / ph);
  const out = canvas(w, h);
  const octx = out.getContext('2d')!;
  const probe = octx as CanvasRenderingContext2D & { filter?: string };
  if (typeof probe.filter === 'string') {
    probe.filter = 'blur(6px) saturate(1.35)';
    // ふちが透けないよう少し大きめに描く
    const m = 1.25;
    octx.drawImage(photo, (w - pw * s * m) / 2, (h - ph * s * m) / 2, pw * s * m, ph * s * m);
    probe.filter = 'none';
    if (probe.filter === 'none') return out;
  }
  // 代わりの方法：とても小さくしてから、位置をずらして何度も重ねる（すじが出ないように）
  const tiny = canvas(18, Math.round((18 * h) / w));
  const tctx = tiny.getContext('2d')!;
  const ts = Math.max(tiny.width / pw, tiny.height / ph);
  tctx.drawImage(photo, (tiny.width - pw * ts) / 2, (tiny.height - ph * ts) / 2, pw * ts, ph * ts);
  octx.clearRect(0, 0, w, h);
  octx.imageSmoothingQuality = 'high';
  const steps = [-6, -3, 0, 3, 6];
  octx.globalAlpha = 1 / 3;
  for (const dx of steps) for (const dy of steps) {
    octx.drawImage(tiny, dx - 6, dy - 6, w + 12, h + 12);
    octx.globalAlpha = Math.max(0.04, octx.globalAlpha * 0.88);
  }
  octx.globalAlpha = 1;
  return out;
}

/** 背景：写真の色の地＋大きくぼかした写真＋光＋周辺を暗く（画面の .bg と同じ構成） */
function renderBackground(photo: CanvasImageSource | undefined, pw: number, ph: number, pal: Palette, season: Season): HTMLCanvasElement {
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, W, H);
  if (photo && pw && ph) {
    const bw = W * 1.3;
    const bh = H * 1.3;
    ctx.globalAlpha = 0.34;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blurred(photo, pw, ph), (W - bw) / 2, (H - bh) / 2, bw, bh);
    ctx.globalAlpha = 1;
  }
  // 光（2か所）
  const glow = (cx: number, cy: number, rx: number, ry: number, color: string) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, color);
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  };
  glow(W * 0.22, H * 0.28, W * 0.7, H * 0.5, pal.glow1);
  glow(W * 0.8, H * 0.74, W * 0.65, H * 0.55, pal.glow2);
  // 写真を撮った季節の色（画面の .bg-season と同じ）
  for (const tn of SEASON_TINT[season]) {
    ctx.save();
    ctx.translate(W * tn.x, H * tn.y);
    ctx.scale(1, (H * tn.ry) / (W * tn.rx));
    const r = W * tn.rx;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, tn.color);
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // 周辺を暗く
  ctx.save();
  ctx.translate(W * 0.5, H * 0.48);
  ctx.scale(1, (H * 0.75) / (W * 0.85));
  const v = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.85);
  v.addColorStop(0.3, 'rgba(0,0,0,0.12)');
  v.addColorStop(1, 'rgba(0,0,0,0.66)');
  ctx.fillStyle = v;
  ctx.fillRect(-W * 2, -W * 2, W * 4, W * 4);
  ctx.restore();
  return c;
}

/** 動画の素材を開く（Mediabunny）。読めない形式なら null */
async function openVideo(blob: Blob) {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose?.();
      return null;
    }
    return { input, track, duration: await input.computeDuration() };
  } catch {
    return null;
  }
}

/** 決まった時刻のコマを、頭から順番に取り出す */
function frameStream(track: NonNullable<Awaited<ReturnType<typeof openVideo>>>['track'], px: number, times: number[]): FrameStream {
  const sink = new CanvasSink(track, { width: px, height: px, fit: 'cover', poolSize: 3 });
  const it = sink.canvasesAtTimestamps(times);
  let done = false;
  return {
    async next() {
      if (done) return null;
      const r = await it.next();
      if (r.done) {
        done = true;
        return null;
      }
      return r.value ? (r.value.canvas as CanvasImageSource) : null;
    },
    close() {
      done = true;
      void it.return(undefined).catch(() => {});
    },
  };
}

function htmlVideo(blob: Blob): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  return new Promise((ok) => {
    const done = () => ok({ video, url });
    video.onloadeddata = done;
    video.onerror = done;
    setTimeout(done, 8000);
  });
}

/** 動画の指定の時刻のコマに合わせる（順番に取り出せない端末のときだけ使う。遅い） */
function seek(v: HTMLVideoElement, sec: number): Promise<void> {
  const target = Math.max(0, Math.min(sec, (v.duration || 0) - 0.04));
  if (Math.abs(v.currentTime - target) < 0.012) return Promise.resolve();
  return new Promise((ok) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(t);
      ok();
    };
    const t = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

// ---------------------------------------------------------------- 文字

const FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif`;
const NO_LINE_START = '、。，．・：；？！ー」』）】〉》ぁぃぅぇぉっゃゅょァィゥェォッャュョ';

/** 日本語を幅に合わせて折り返す（行頭に「、」などが来ないように） */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > width && line && !NO_LINE_START.includes(ch)) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, -1) + '…';
    return cut;
  }
  return lines;
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

function shadowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, glow: string, blur: number) {
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.fillText(text, x, y); // 二度描きで影を濃く（画面の text-shadow に近づける）
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** 字幕（日付とコメント）を、影つきで1回だけ描いておく */
function renderCaption(slide: Slide, pl: Placement, shape: PhotoShape, showDate: boolean): Prepared['caption'] {
  const hasComment = !!slide.comment && !!slide.media;
  if (!hasComment && !showDate) return undefined;
  const PAD = 18; // 影の分の余白
  const measure = canvas(1, 1).getContext('2d')!;
  measure.font = `16px ${FONT}`;
  const lines = hasComment ? wrap(measure, slide.comment, pl.commentWidth, 4) : [];
  const lh = 16 * 1.75;
  const dateH = showDate ? 12 * 1.6 + 2 : 0;
  const w = pl.commentWidth + PAD * 2;
  const h = dateH + lines.length * lh + PAD * 2;
  const c = canvas(w * SCALE, h * SCALE);
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const cx = w / 2;
  let y = PAD;
  if (showDate) {
    ctx.font = `12px ${FONT}`;
    setSpacing(ctx, 1.4);
    shadowText(ctx, formatDot(slide.date), cx, y + 2, 'rgba(255,246,232,0.62)', 'rgba(0,0,0,0.8)', 10 * (SCALE / 2));
    y += dateH;
  }
  ctx.font = `16px ${FONT}`;
  setSpacing(ctx, 0);
  lines.forEach((line, n) => shadowText(ctx, line, cx, y + n * lh + (lh - 16) / 2, '#fbf3e6', 'rgba(0,0,0,0.85)', 12 * (SCALE / 2)));
  return { canvas: c, x: pl.x + pl.commentLeft - PAD, y: pl.y + pl.d * CAPTION_TOP[shape] - 6 - PAD, w, h };
}

/** 写真のない記録：丸い淡い光の中に文字（1回だけ描いておく） */
function renderTextCircle(pl: Placement, text: string): HTMLCanvasElement {
  const c = canvas(pl.d * SCALE, pl.d * SCALE);
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  const r = pl.d / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r * Math.SQRT2);
  g.addColorStop(0, 'rgba(255,230,190,0.16)');
  g.addColorStop(0.55, 'rgba(255,230,190,0.06)');
  g.addColorStop(0.72, 'rgba(255,230,190,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `17px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, pl.d * 0.64, 6);
  const lh = 17 * 1.8;
  lines.forEach((line, n) => shadowText(ctx, line, r, r + (n - (lines.length - 1) / 2) * lh, '#f8eedf', 'rgba(0,0,0,0.6)', 16 * (SCALE / 2)));
  return c;
}

/** 文字の影：キャンバスの影はキャンバスの拡大の影響を受けないので、拡大率をかけた大きさで渡す */
function tagsCanvas(text: string): HTMLCanvasElement {
  const m = canvas(1, 1).getContext('2d')!;
  m.font = `12px ${FONT}`;
  const w = m.measureText(text).width + 40;
  const c = canvas(w * SCALE, 36 * SCALE);
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  setSpacing(ctx, 0.5);
  shadowText(ctx, text, w / 2, 12, '#e6d9c8', 'rgba(0,0,0,0.8)', 10 * (SCALE / 2));
  return c;
}

// ---------------------------------------------------------------- 光の粒・季節の粒の絵（1回だけ描いて使い回す）

const spriteCache = new Map<string, HTMLCanvasElement>();
const SPRITE = 64;

/** 写真の色の光の粒 */
function moteSprite(color: string): HTMLCanvasElement {
  const key = `mote|${color}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = canvas(SPRITE, SPRITE);
  const ctx = c.getContext('2d')!;
  const r = SPRITE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, SPRITE * Math.SQRT1_2);
  g.addColorStop(0, '#fff8ec');
  g.addColorStop(0.22, color);
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  spriteCache.set(key, c);
  return c;
}

/** 季節の粒（花びら・葉・雪・ほたる）。大きさ1の形を SPRITE の大きさで描いておく */
function particleSprite(p: Particle): HTMLCanvasElement {
  const key = `p|${p.kind}|${p.color}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = canvas(SPRITE, SPRITE);
  const ctx = c.getContext('2d')!;
  const s = SPRITE;
  ctx.translate(s / 2, s / 2);
  if (p.kind === 'petal' || p.kind === 'leaf') {
    // 横 w × 縦 h の楕円（w を SPRITE の 0.6 倍にして、傾けてもはみ出さないように）
    const w = s * 0.6;
    const h = p.kind === 'petal' ? w * 0.62 : w * 0.8;
    const g = ctx.createRadialGradient(-w * 0.1, -h * 0.12, 0, 0, 0, w * 0.6);
    g.addColorStop(0, p.kind === 'petal' ? '#fff7fa' : p.color);
    g.addColorStop(p.kind === 'petal' ? 0.62 : 1, p.color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, p.kind === 'leaf' ? Math.PI / 4 : 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const r = s * 0.3;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.414);
    g.addColorStop(0, p.kind === 'snow' ? '#ffffff' : '#fffde6');
    g.addColorStop(p.kind === 'snow' ? 0.35 : 0.26, p.kind === 'snow' ? 'rgba(255,255,255,0.85)' : p.color);
    g.addColorStop(0.7, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  spriteCache.set(key, c);
  return c;
}

/**
 * 1枚分の素材を用意する。
 * videoTimes：動画のとき、各コマで使う動画の時刻（秒）。順番に取り出すために先に決めておく
 */
async function prepare(
  slide: Slide,
  shape: PhotoShape,
  showDate: boolean,
  opts: { videoTimes?: number[]; realtime: boolean },
): Promise<Prepared> {
  const placement = place(slide.key, LW, LH);
  const px = Math.round(placement.d * SCALE);
  const media = slide.media;
  const caption = renderCaption(slide, placement, shape, showDate);
  const season = seasonOf(slide.date);

  if (media?.kind === 'photo' && !media.missing) {
    const blob = await loadFile(media.id);
    if (blob) {
      const img = await toBitmap(blob);
      const [w, h] = sizeOf(img);
      const palette = extractPalette(img);
      const shaped = canvas(px, px);
      drawShaped(shaped.getContext('2d')!, img, w, h, px, shape, slide.key);
      const bg = renderBackground(img, w, h, palette, season);
      if ('close' in img) img.close();
      return { placement, palette, bg, shaped, caption, missing: false, dispose: () => {} };
    }
  }

  if (media?.kind === 'video' && !media.missing) {
    const blob = await loadFile(media.id);
    if (blob) {
      const thumbBlob = media.hasThumb ? await loadFile(thumbKey(media.id)) : null;
      let palette = DEFAULT_PALETTE;
      let bg: HTMLCanvasElement;
      if (thumbBlob) {
        const t = await toBitmap(thumbBlob);
        palette = extractPalette(t);
        const [bw, bh] = sizeOf(t);
        bg = renderBackground(t, bw, bh, palette, season);
        if ('close' in t) t.close();
      } else bg = renderBackground(undefined, 0, 0, palette, season);
      const base = { placement, palette, bg, caption, videoCanvas: canvas(px, px), missing: false };

      // きれいに書き出すとき：頭から順番にコマを取り出す
      if (!opts.realtime && opts.videoTimes) {
        const v = await openVideo(blob);
        if (v) {
          const frames = frameStream(v.track, px, opts.videoTimes);
          return {
            ...base,
            frames,
            dispose: () => {
              frames.close();
              v.input.dispose?.();
            },
          };
        }
      }
      // 再生しながら録画するとき、または順番に取り出せない端末：<video> で
      const { video, url } = await htmlVideo(blob);
      return {
        ...base,
        video,
        missing: !video.videoWidth,
        dispose: () => {
          video.pause();
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        },
      };
    }
  }

  // 写真のない記録・見つからない写真
  return {
    placement,
    palette: DEFAULT_PALETTE,
    bg: renderBackground(undefined, 0, 0, DEFAULT_PALETTE, season),
    textCircle: renderTextCircle(placement, media ? '画像が見つかりません' : slide.memory.text),
    caption,
    missing: !!media,
    dispose: () => {},
  };
}

/** 動画の長さ（秒）。読めなければ null */
async function videoDuration(blob: Blob): Promise<number | null> {
  const v = await openVideo(blob);
  if (v) {
    v.input.dispose?.();
    return v.duration;
  }
  const { video, url } = await htmlVideo(blob);
  const d = video.duration;
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(url);
  return isFinite(d) && d > 0 ? d : null;
}

// ---------------------------------------------------------------- 音（BGM と動画の音）

interface Clip {
  buffer: AudioBuffer;
  /** 鳴り始め・鳴り終わり（ミリ秒） */
  from: number;
  to: number;
}

interface Soundtrack {
  bgm: AudioBuffer | null;
  clips: Clip[];
  total: number;
}

/** 動画ファイルから音だけを取り出す（音がない・読めないときは null） */
async function decodeVideoAudio(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    // ほぼ無音なら入れない
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
    return peak > 0.002 ? buf : null;
  } catch {
    return null;
  }
}

async function buildSoundtrack(slides: Slide[], timing: Timing, bgm: BgmChoice): Promise<Soundtrack> {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const bgmBuf = await bgmBuffer(bgm, ctx).catch(() => null);
  const clips: Clip[] = [];
  for (let i = 0; i < slides.length; i++) {
    const m = slides[i].media;
    if (m?.kind !== 'video' || m.missing) continue;
    const blob = await loadFile(m.id);
    const buf = blob && (await decodeVideoAudio(blob));
    if (!buf) continue;
    // 画面の再生と同じく、スライドが始まったら動画の頭から流す
    const from = timing.start[i];
    const to = Math.min(from + buf.duration * 1000, from + timing.dwell[i] - FADE_MS / 2);
    clips.push({ buffer: buf, from, to });
  }
  return { bgm: bgmBuf, clips, total: timing.total };
}

/** 時刻 t（ミリ秒）の BGM の音量：最初はふわっと、最後はゆっくり消える。動画の音の間は小さく */
function bgmGainAt(t: number, s: Soundtrack): number {
  const fadeIn = clamp01(t / 2000);
  const fadeOut = clamp01((s.total - t) / 3000);
  let duck = 1;
  for (const c of s.clips) {
    // 前後 0.6 秒でなめらかに小さく／大きく
    const k = Math.min(clamp01((t - (c.from - 600)) / 600), clamp01((c.to + 600 - t) / 600));
    duck = Math.min(duck, 1 - k * (1 - DUCK));
  }
  return BGM_VOLUME * Math.min(fadeIn, fadeOut) * duck;
}

/** 音のある区間 [fromMs, toMs) を演奏した結果を返す（オフラインで、実時間より速く） */
async function renderSound(s: Soundtrack, fromMs: number, toMs: number): Promise<AudioBuffer> {
  const frames = Math.round(((toMs - fromMs) / 1000) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  if (s.bgm) {
    const src = ctx.createBufferSource();
    src.buffer = s.bgm;
    src.loop = true;
    const g = ctx.createGain();
    for (let t = fromMs; t <= toMs; t += 100) g.gain.setValueAtTime(bgmGainAt(t, s), (t - fromMs) / 1000);
    src.connect(g).connect(ctx.destination);
    src.start(0, (fromMs / 1000) % s.bgm.duration);
  }
  for (const c of s.clips) {
    if (c.to <= fromMs || c.from >= toMs) continue;
    const src = ctx.createBufferSource();
    src.buffer = c.buffer;
    const g = ctx.createGain();
    const startAt = Math.max(c.from, fromMs);
    // 終わりの 0.4 秒で小さくする
    g.gain.setValueAtTime(1, 0);
    const fadeStart = (c.to - 400 - fromMs) / 1000;
    if (fadeStart > 0) g.gain.setValueAtTime(1, fadeStart);
    g.gain.linearRampToValueAtTime(0, (c.to - fromMs) / 1000);
    src.connect(g).connect(ctx.destination);
    src.start((startAt - fromMs) / 1000, (startAt - c.from) / 1000, (c.to - startAt) / 1000);
  }
  return ctx.startRendering();
}

/** 実時間の録画用：音を AudioContext に予約して流す */
function scheduleRealtimeSound(ctx: AudioContext, dest: AudioNode, s: Soundtrack, at: number) {
  const nodes: AudioScheduledSourceNode[] = [];
  if (s.bgm) {
    const src = ctx.createBufferSource();
    src.buffer = s.bgm;
    src.loop = true;
    const g = ctx.createGain();
    for (let t = 0; t <= s.total; t += 100) g.gain.setValueAtTime(bgmGainAt(t, s), at + t / 1000);
    src.connect(g).connect(dest);
    src.start(at);
    nodes.push(src);
  }
  for (const c of s.clips) {
    const src = ctx.createBufferSource();
    src.buffer = c.buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, at + (c.to - 400) / 1000);
    g.gain.linearRampToValueAtTime(0, at + c.to / 1000);
    src.connect(g).connect(dest);
    src.start(at + c.from / 1000, 0, (c.to - c.from) / 1000);
    nodes.push(src);
  }
  return () => nodes.forEach((n) => {
    try {
      n.stop();
    } catch {
      /* 止まっている */
    }
  });
}

const hasSound = (s: Soundtrack) => !!s.bgm || s.clips.length > 0;

// ---------------------------------------------------------------- 1コマを描く

class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prepared = new Map<number, Promise<Prepared>>();
  private ready = new Map<number, Prepared>();
  private tags = new Map<string, HTMLCanvasElement>();
  private videoSec = new Map<number, number>();
  timing: Timing;

  constructor(
    private slides: Slide[],
    private showDate: boolean,
    readonly shape: PhotoShape,
    /** 再生しながら録画する（動画は再生して描く） */
    readonly realtime: boolean,
    private prof: Prof,
  ) {
    this.canvas = canvas(W, H);
    this.ctx = this.canvas.getContext('2d', { alpha: false }) ?? this.canvas.getContext('2d')!;
    this.timing = schedule(slides, new Map());
  }

  /** 動画の長さを調べて、タイミングを決め直す */
  async measureVideos() {
    for (let i = 0; i < this.slides.length; i++) {
      const m = this.slides[i].media;
      if (m?.kind !== 'video' || m.missing) continue;
      const blob = await loadFile(m.id);
      const d = blob && (await videoDuration(blob));
      if (d) this.videoSec.set(i, d);
    }
    this.timing = schedule(this.slides, this.videoSec);
  }

  get frameCount() {
    return Math.ceil((this.timing.total / 1000) * FPS);
  }

  private end(i: number) {
    const { start, dwell } = this.timing;
    return start[i] + dwell[i] + (i === this.slides.length - 1 ? FADE_MS : 0);
  }
  private nextStart(i: number) {
    const { start, dwell } = this.timing;
    return i < this.slides.length - 1 ? start[i + 1] : start[i] + dwell[i];
  }

  /** 動画のスライドで、各コマに使う動画の時刻（秒）。画面の再生と同じく、次の写真が出始めたら止まる */
  videoTimes(i: number): number[] {
    const s = this.timing.start[i];
    const from = Math.ceil((s * FPS) / 1000);
    const to = Math.ceil((this.end(i) * FPS) / 1000);
    const dur = this.videoSec.get(i) ?? VIDEO_MAX_MS / 1000;
    const times: number[] = [];
    for (let n = from; n < to; n++) {
      const t = (n * 1000) / FPS;
      if (t < s) continue;
      const clock = Math.min(t, this.nextStart(i));
      times.push(Math.max(0, Math.min((clock - s) / 1000, dur - 1 / FPS)));
    }
    return times;
  }

  /** コマごとの種類（動画が映っているか）。残り時間の見積もりに使う */
  frameKinds(): Uint8Array {
    const kinds = new Uint8Array(this.frameCount);
    this.slides.forEach((sl, i) => {
      if (sl.media?.kind !== 'video' || sl.media.missing) return;
      const from = Math.ceil((this.timing.start[i] * FPS) / 1000);
      const to = Math.min(kinds.length, Math.ceil((this.end(i) * FPS) / 1000));
      for (let n = from; n < to; n++) kinds[n] = 1;
    });
    return kinds;
  }

  get videoCount() {
    return this.slides.filter((s) => s.media?.kind === 'video' && !s.media.missing).length;
  }

  need(i: number): Promise<Prepared> {
    let p = this.prepared.get(i);
    if (!p) {
      const s = this.slides[i];
      const isVideo = s.media?.kind === 'video';
      p = prepare(s, this.shape, this.showDate, {
        realtime: this.realtime,
        videoTimes: isVideo && !this.realtime ? this.videoTimes(i) : undefined,
      }).then((r) => {
        this.ready.set(i, r);
        return r;
      });
      this.prepared.set(i, p);
    }
    return p;
  }

  release(i: number) {
    this.ready.get(i)?.dispose();
    this.ready.delete(i);
    this.prepared.delete(i);
  }

  /** 時刻 t（ミリ秒）に必要なスライド */
  private active(t: number) {
    const { start } = this.timing;
    const visible: number[] = [];
    let current = 0;
    for (let i = 0; i < this.slides.length; i++) {
      if (start[i] <= t) current = i;
      if (start[i] <= t && t < this.end(i)) visible.push(i);
    }
    return { visible, current };
  }

  /** 次に使う素材を先に用意し、使い終わった素材を片付ける */
  async prepareFor(t: number) {
    const { visible, current } = this.active(t);
    const keep = new Set([...visible, current, current - 1, current + 1].filter((i) => i >= 0 && i < this.slides.length));
    for (const i of keep) await this.need(i);
    for (const i of [...this.prepared.keys()]) if (!keep.has(i)) this.release(i);
  }

  /** 少し先に使う素材を、今の素材を片付けずに用意しておく */
  prefetch(t: number) {
    const { current } = this.active(t);
    void this.need(current).catch(() => {});
  }

  /** t（ミリ秒）のコマを描く */
  async draw(t: number) {
    const ctx = this.ctx;
    const prof = this.prof;
    const { start, total } = this.timing;
    const { visible, current } = this.active(t);
    prof.mark();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b0908';
    ctx.fillRect(0, 0, W, H);

    // 背景：今のスライドの背景が、前の背景の上にゆっくり重なる
    const bgAlpha = clamp01((t - start[current]) / BG_FADE_MS);
    const prevBg = this.ready.get(current - 1);
    const curBg = this.ready.get(current);
    if (prevBg && bgAlpha < 1) ctx.drawImage(prevBg.bg, 0, 0);
    if (curBg) {
      ctx.globalAlpha = current === 0 ? 1 : ease(bgAlpha);
      ctx.drawImage(curBg.bg, 0, 0);
      ctx.globalAlpha = 1;
    }
    prof.lap('背景（ぼかし写真の重ね描き）');

    // 光の粒（写真の色で、色もゆっくり移り変わる）
    const pal1 = curBg?.palette ?? DEFAULT_PALETTE;
    const pal0 = prevBg?.palette ?? pal1;
    this.drawMotes(t / 1000, pal0.glow1, pal1.glow1, bgAlpha);

    // 季節の粒：季節が変わったら、新しい季節の粒がふわっと出てくる
    const s1 = seasonOf(this.slides[current].date);
    const s0 = current > 0 ? seasonOf(this.slides[current - 1].date) : s1;
    const sa = s0 === s1 ? 1 : ease(bgAlpha);
    if (s0 !== s1 && sa < 1) this.drawSeason(t / 1000, s0, 1 - sa);
    this.drawSeason(t / 1000, s1, sa);
    prof.lap('光の粒・季節の粒');

    // タグ（上に小さく）。同じ記録が続いている間は出したまま、記録が変わったらフェードイン
    const curSlide = this.slides[current];
    if (curSlide.memory.tags.length) {
      let j = current;
      while (j > 0 && this.slides[j - 1].memory.id === curSlide.memory.id) j--;
      const text = curSlide.memory.tags.map((x) => `#${x}`).join('  ');
      let tc = this.tags.get(text);
      if (!tc) this.tags.set(text, (tc = tagsCanvas(text)));
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.globalAlpha = ease(clamp01((t - start[j]) / 1600));
      ctx.drawImage(tc, LW / 2 - tc.width / SCALE / 2, 56, tc.width / SCALE, tc.height / SCALE);
      ctx.globalAlpha = 1;
    }

    // 写真（重なっている間は2枚）
    for (const i of visible) {
      const p = this.ready.get(i);
      if (!p) continue;
      const nextStart = this.nextStart(i);
      // 動画は、映っている間は毎コマ1つずつ取り出す（見えないくらい薄いコマでも順番を守る）
      await this.advanceVideo(i, p, t, nextStart);
      const fadeIn = ease(clamp01((t - start[i]) / FADE_MS));
      const fadeOut = t >= nextStart ? 1 - ease(clamp01((t - nextStart) / FADE_MS)) : 1;
      const opacity = Math.min(fadeIn, fadeOut);
      if (opacity > 0) this.drawSlide(i, p, t, opacity);
    }
    prof.lap('写真・字幕を描く');

    // 最初は黒からふわっと始まり、最後はゆっくり暗くなって終わる
    const openDark = 1 - ease(clamp01(t / OPEN_MS));
    const endStart = total - TAIL_MS - FADE_MS;
    const endDark = ease(clamp01((t - endStart) / (FADE_MS + TAIL_MS))) * 0.85;
    const dark = Math.max(openDark, endDark);
    if (dark > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = dark;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** 動画のコマを1つ進めて、形に切り抜く */
  private async advanceVideo(i: number, p: Prepared, t: number, nextStart: number) {
    if (!p.videoCanvas || p.missing) return;
    const vctx = p.videoCanvas.getContext('2d')!;
    const px = p.videoCanvas.width;
    const key = this.slides[i].key;
    this.prof.lap('写真・字幕を描く');
    if (p.frames) {
      // 頭から順番に取り出す（速い）
      const img = await p.frames.next();
      if (img) {
        drawShaped(vctx, img, px, px, px, this.shape, key);
        p.hasFrame = true;
      }
    } else if (p.video) {
      const v = p.video;
      if (this.realtime) {
        // 再生しながら録画：動画もそのまま再生して、今のコマを描く
        if (!p.videoStarted) {
          p.videoStarted = true;
          v.currentTime = 0;
          void v.play().catch(() => {});
        }
        if (t >= nextStart && !v.paused) v.pause();
      } else {
        // 順番に取り出せない端末：その時刻のコマを探す（遅い）
        await seek(v, (Math.min(t, nextStart) - this.timing.start[i]) / 1000);
      }
      if (v.readyState >= 2 && v.videoWidth) {
        drawShaped(vctx, v, v.videoWidth, v.videoHeight, px, this.shape, key);
        p.hasFrame = true;
      }
    }
    this.prof.lap('動画素材のコマを取り出す');
  }

  /** 季節の粒（画面の SeasonParticles と同じ動き） */
  private drawSeason(sec: number, season: Season, alpha: number) {
    const ctx = this.ctx;
    for (const p of particles(season)) this.drawParticle(ctx, p, sec, alpha);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: Particle, sec: number, alpha: number) {
    const swing = (period: number) => {
      const cyc = (sec + p.delay) / period;
      const n = Math.floor(cyc);
      const f = cyc - n;
      return easeInOut(n % 2 === 1 ? 1 - f : f);
    };
    let x = (p.left / 100) * LW;
    let y: number;
    let rot = 0;
    let a = alpha;
    if (p.kind === 'firefly') {
      // その場で漂いながら明滅
      const e = swing(p.fall);
      x += lerp(-p.drift / 3, p.drift / 3, e);
      y = (p.top / 100) * LH + lerp(p.drift / 5, -p.drift / 5, e);
      a *= lerp(0.08, 1, swing(p.blink));
    } else {
      // 上から下へ落ちながら、左右にゆれて回る
      const f = (((sec + p.delay) / p.fall) % 1 + 1) % 1;
      x += p.drift * f;
      y = lerp(-0.12 * LH, 1.12 * LH, f);
      rot = (p.spin * f * Math.PI) / 180;
    }
    const w = p.size;
    const h = p.kind === 'petal' ? p.size * 0.62 : p.kind === 'leaf' ? p.size * 0.8 : p.size;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rot);
    if (p.kind !== 'firefly') ctx.translate(lerp(-p.swayPx, p.swayPx, swing(p.sway)), 0);
    ctx.globalAlpha = a * (p.kind === 'petal' ? 0.82 : p.kind === 'leaf' ? 0.85 : p.kind === 'snow' ? 0.9 : 1);
    // 先に描いておいた絵を、大きさに合わせて置く（絵の 0.6 倍が粒の幅）
    const D = w / 0.6;
    ctx.drawImage(particleSprite(p), -D / 2, -D / 2, D, D);
  }

  /** 写真の色の光の粒。色が移り変わる間は、前の色と今の色の粒を重ねる */
  private drawMotes(sec: number, color0: string, color1: string, mix: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sp1 = moteSprite(color1);
    const sp0 = color0 !== color1 && mix < 1 ? moteSprite(color0) : null;
    // 半分は写真の色の粒（残りの半分は季節の粒）
    MOTES.forEach((m, k) => {
      if (k % 2 === 1) return;
      // CSS: mote（行って戻る、ease-in-out）。開始は負の遅れで途中から
      const cyc = (sec + m.delay) / m.dur;
      const n = Math.floor(cyc);
      let f = cyc - n;
      if (n % 2 === 1) f = 1 - f;
      const e = easeInOut(f);
      const tx = lerp(-28, 36, e) * SCALE;
      const ty = lerp(20, -30, e) * SCALE;
      const sc = lerp(0.75, 1.15, e);
      const alpha = lerp(0.2, 0.85, e);
      const size = m.size * SCALE;
      const cx = (m.left / 100) * W + size / 2 + tx;
      const cy = (m.top / 100) * H + size / 2 + ty;
      const r = (size / 2) * sc;
      if (sp0) {
        ctx.globalAlpha = alpha * (1 - mix);
        ctx.drawImage(sp0, cx - r, cy - r, r * 2, r * 2);
        ctx.globalAlpha = alpha * mix;
      } else ctx.globalAlpha = alpha;
      ctx.drawImage(sp1, cx - r, cy - r, r * 2, r * 2);
    });
    ctx.globalAlpha = 1;
  }

  private drawSlide(i: number, p: Prepared, t: number, opacity: number) {
    const ctx = this.ctx;
    const slide = this.slides[i];
    const pl = p.placement;
    const local = t - this.timing.start[i];

    // 漂い（CSS の float：-向き → +向き、0.97 → 1.03 倍）
    const f = easeInOut(clamp01(local / driftMs(slide)));
    const dx = lerp(-pl.dx, pl.dx, f);
    const dy = lerp(-pl.dy, pl.dy, f);
    const sc = lerp(0.97, 1.03, f);
    const cx = pl.x + pl.d / 2;
    const cy = pl.y + pl.d / 2;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.translate(cx + dx, cy + dy);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = opacity;

    if (p.shaped) ctx.drawImage(p.shaped, pl.x, pl.y, pl.d, pl.d);
    else if (p.videoCanvas && p.hasFrame) ctx.drawImage(p.videoCanvas, pl.x, pl.y, pl.d, pl.d);
    else if (p.textCircle) ctx.drawImage(p.textCircle, pl.x, pl.y, pl.d, pl.d);

    // 字幕（日付とコメント）：写真より少し遅れてふわっと
    const cap = p.caption;
    if (cap) {
      const k = ease(clamp01((local - COMMENT_DELAY_MS) / COMMENT_FADE_MS));
      if (k > 0) {
        ctx.globalAlpha = opacity * k;
        ctx.drawImage(cap.canvas, cap.x, cap.y + (1 - k) * 8, cap.w, cap.h);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose() {
    for (const i of [...this.prepared.keys()]) this.release(i);
  }
}

// ---------------------------------------------------------------- 残り時間の見積もり

/**
 * 写真のコマと動画のコマは速さが違うので、別々に測って足し合わせる：
 *   残り時間 ＝ 残りの写真のコマ数 × 写真1コマの時間 ＋ 残りの動画のコマ数 × 動画1コマの時間
 * 動画の速さは、書き出しの最初に少しだけ試しに取り出して測る。
 * 画面の表示は、急に増えたり減ったりしないよう、なめらかに近づける。
 */
class Estimator {
  private cost = [0, 0];
  private samples = [0, 0];
  private done = [0, 0];
  private total = [0, 0];
  /** 動画のコマで、写真のコマより余分にかかる時間（試しに測った値） */
  videoExtra: number | null = null;
  private began = performance.now();
  private shown: number | null = null;
  private lastShown = 0;
  private ratio = 0;

  constructor(private kinds: Uint8Array) {
    for (const k of kinds) this.total[k]++;
  }

  record(n: number, ms: number) {
    const k = this.kinds[n];
    this.done[k]++;
    this.samples[k]++;
    // 最近の速さを重く見る（素材の準備などで一時的に遅いコマも、ならして反映する）
    this.cost[k] = this.samples[k] === 1 ? ms : this.cost[k] * 0.96 + ms * 0.04;
  }

  /** 残り時間（ミリ秒）。まだ測れていなければ null */
  private estimate(): number | null {
    const elapsed = performance.now() - this.began;
    const photoReady = this.samples[0] >= 45 || (this.total[0] === 0 && this.samples[1] >= 15) || elapsed > 15000;
    const videoReady = this.total[1] === 0 || this.samples[1] >= 20 || this.videoExtra != null;
    if (!photoReady || !videoReady) return null;
    const cP = this.samples[0] ? this.cost[0] : this.cost[1];
    const cV = this.samples[1] >= 20 ? this.cost[1] : cP + (this.videoExtra ?? 0);
    return (this.total[0] - this.done[0]) * cP + (this.total[1] - this.done[1]) * cV;
  }

  progress(label?: string): ExportProgress {
    const now = performance.now();
    const est = this.estimate();
    const framesDone = this.done[0] + this.done[1];
    const framesAll = this.total[0] + this.total[1] || 1;
    if (est == null) {
      this.ratio = Math.max(this.ratio, (framesDone / framesAll) * 0.5);
      return { ratio: this.ratio, label: label ?? '残り時間を計算中…' };
    }
    const sec = est / 1000;
    if (this.shown == null) this.shown = sec;
    else {
      // 時間がたった分は減らし、新しい見積もりには少しずつ近づける
      const dt = (now - this.lastShown) / 1000;
      this.shown = Math.max(0, this.shown - dt);
      this.shown += (sec - this.shown) * 0.12;
    }
    this.lastShown = now;
    const work = (now - this.began) / 1000;
    // バーも、目標に少しずつ近づける（急に飛ばないように）。戻ることはない
    const target = Math.min(0.995, work / (work + this.shown));
    this.ratio = Math.max(this.ratio, this.ratio + (target - this.ratio) * 0.25);
    return { ratio: this.ratio, remainingSec: this.shown, label };
  }
}

// ---------------------------------------------------------------- 動画にする

const canRecordRealtime = () => typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

/** この端末でできること（書き出す前の画面で使う） */
export async function exportCapabilities(): Promise<{ encode: boolean; high: boolean; realtime: boolean }> {
  const check = async (q: ExportQuality) => {
    try {
      const s = QUALITY[q];
      return await canEncodeVideo('avc', { width: LW * s.scale, height: LH * s.scale, bitrate: s.bitrate });
    } catch {
      return false;
    }
  };
  return { encode: await check('standard'), high: await check('high'), realtime: canRecordRealtime() };
}

/** AAC（音）に変換できるようにする。端末にできなければ、変換の部品（WebAssembly）を読み込む */
async function ensureAac(): Promise<boolean> {
  try {
    if (await canEncodeAudio('aac')) return true;
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    return await canEncodeAudio('aac');
  } catch {
    return false;
  }
}

const abortError = () => new DOMException('中止しました', 'AbortError');
const yieldToScreen = () => new Promise((ok) => setTimeout(ok, 0));

export async function exportMovie(o: ExportOptions): Promise<ExportResult> {
  const began = performance.now();
  const prof = new Prof();
  setQuality(o.quality);
  let downgraded = false;
  let realtime = o.mode === 'realtime';
  if (!realtime) {
    const caps = await exportCapabilities();
    if (o.quality === 'high' && !caps.high && caps.encode) {
      setQuality('standard');
      downgraded = true;
    }
    if (!caps.encode) realtime = true; // 変換機能がない古い端末：再生しながら録画に切り替える
  }
  if (realtime && !canRecordRealtime()) throw new Error('この端末・ブラウザは動画の書き出しに対応していません');

  const r = new Renderer(o.slides, o.showDate, o.shape, realtime, prof);
  try {
    o.onProgress({ ratio: 0, label: '素材を確かめています…' });
    prof.mark();
    await r.measureVideos();
    prof.lap('素材の準備');
    const sound = await buildSoundtrack(o.slides, r.timing, o.bgm);
    prof.lap('音（BGM・動画の音）');
    const withSound = hasSound(sound);
    let result: Omit<ExportResult, 'stats'>;
    let method: string;
    if (realtime) {
      method = '再生しながら録画（MediaRecorder）';
      result = await recordRealtime(r, withSound && o.audioCtx ? { sound, ctx: o.audioCtx } : null, o.onProgress, o.signal);
    } else {
      const audioOk = withSound && (await ensureAac());
      method = 'WebCodecs（ハードウェア変換）＋ Mediabunny';
      result = await encodeFrames(r, audioOk ? sound : null, prof, o.onProgress, o.signal);
    }
    const stats: ExportStats = {
      method,
      quality: `${W}×${H}`,
      frames: r.frameCount,
      seconds: (performance.now() - began) / 1000,
      parts: Object.fromEntries(Object.entries(prof.parts).map(([k, v]) => [k, Math.round(v / 100) / 10])),
    };
    (globalThis as unknown as { __exportStats?: ExportStats }).__exportStats = stats;
    return { ...result, downgraded, stats };
  } finally {
    r.dispose();
  }
}

/** 動画のコマの速さを、少しだけ試しに取り出して測る（残り時間の見積もり用） */
async function probeVideoSpeed(r: Renderer, slides: Slide[]): Promise<number | null> {
  const i = slides.findIndex((s) => s.media?.kind === 'video' && !s.media.missing);
  if (i < 0) return null;
  const blob = await loadFile(slides[i].media!.id);
  const v = blob && (await openVideo(blob));
  if (!v) return null;
  const px = Math.round(place(slides[i].key, LW, LH).d * SCALE);
  const times = r.videoTimes(i).slice(0, 20);
  const stream = frameStream(v.track, px, times);
  const scratch = canvas(px, px).getContext('2d')!;
  const t0 = performance.now();
  let n = 0;
  for (let k = 0; k < times.length; k++) {
    const img = await stream.next();
    if (img) {
      drawShaped(scratch, img, px, px, px, r.shape, slides[i].key);
      n++;
    }
  }
  stream.close();
  v.input.dispose?.();
  return n ? (performance.now() - t0) / n : null;
}

/** きれいに書き出す：1コマずつ描いて、ハードウェアで MP4 に変換する */
async function encodeFrames(
  r: Renderer,
  sound: Soundtrack | null,
  prof: Prof,
  onProgress: ExportOptions['onProgress'],
  signal: AbortSignal,
): Promise<Omit<ExportResult, 'stats'>> {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  // ハードウェアでの変換を優先する（使えない環境では、端末に任せる）
  const accel = (await canEncodeVideo('avc', { width: W, height: H, bitrate: BITRATE, hardwareAcceleration: 'prefer-hardware' }).catch(() => false))
    ? 'prefer-hardware'
    : 'no-preference';
  prof.parts[`（変換：${accel === 'prefer-hardware' ? 'ハードウェア' : '端末まかせ'}）`] = 0;
  const video = new CanvasSource(r.canvas, {
    codec: 'avc',
    bitrate: BITRATE,
    keyFrameInterval: 2,
    hardwareAcceleration: accel,
  });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = sound ? new AudioBufferSource({ codec: 'aac', bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const kinds = r.frameKinds();
  const est = new Estimator(kinds);
  if (r.videoCount) {
    onProgress({ ratio: 0, label: '動画素材の速さを測っています…' });
    prof.mark();
    est.videoExtra = await probeVideoSpeed(r, r['slides'] as Slide[]).catch(() => null);
    prof.lap('速さの試し測り');
  }

  const total = r.timing.total;
  const frames = r.frameCount;
  let audioAt = 0;
  try {
    for (let n = 0; n < frames; n++) {
      if (signal.aborted) throw abortError();
      const f0 = performance.now();
      const t = (n * 1000) / FPS;
      // 音は映像より少し先まで、5秒ずつ作って入れる
      if (audio && sound) {
        while (audioAt < Math.min(total, t + 3000)) {
          const to = Math.min(total, audioAt + 5000);
          prof.mark();
          await audio.add(await renderSound(sound, audioAt, to));
          prof.lap('音（BGM・動画の音）');
          audioAt = to;
        }
      }
      prof.mark();
      await r.prepareFor(t);
      prof.lap('素材の準備');
      await r.draw(t);
      prof.mark();
      await video.add(n / FPS, 1 / FPS);
      prof.lap('エンコード（MP4に変換）');
      est.record(n, performance.now() - f0);
      if (n % 3 === 0 || n === frames - 1) {
        onProgress(est.progress());
        await yieldToScreen(); // 画面が固まらないよう、ときどき画面の更新をはさむ
      }
    }
    video.close();
    audio?.close();
    onProgress({ ratio: 0.995, remainingSec: 1, label: '仕上げています…' });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return {
    blob: new Blob([output.target.buffer!], { type: 'video/mp4' }),
    mime: 'video/mp4',
    ext: 'mp4',
    durationSec: total / 1000,
    audioIncluded: !!audio,
  };
}

/** 速い書き出し：画面の再生と同じように動かしながら、キャンバスを録画する（MediaRecorder） */
async function recordRealtime(
  r: Renderer,
  audio: { sound: Soundtrack; ctx: AudioContext } | null,
  onProgress: ExportOptions['onProgress'],
  signal: AbortSignal,
): Promise<Omit<ExportResult, 'stats'>> {
  const types = audio
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('この端末では動画を書き出せません');
  // 最初のコマを用意してから録画を始める
  await r.prepareFor(0);
  await r.draw(0);
  const video = (r.canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(FPS);
  let stopSound = () => {};
  let dest: MediaStreamAudioDestinationNode | undefined;
  if (audio) {
    await audio.ctx.resume().catch(() => {});
    dest = audio.ctx.createMediaStreamDestination();
  }
  const stream = new MediaStream([...video.getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
  rec.start(1000);
  // 音は AudioContext の時計で予約し、映像は同じ瞬間を 0 として描く
  if (audio && dest) stopSound = scheduleRealtimeSound(audio.ctx, dest, audio.sound, audio.ctx.currentTime + 0.05);
  const t0 = performance.now() + 50;
  const total = r.timing.total;
  try {
    for (;;) {
      if (signal.aborted) throw abortError();
      const t = performance.now() - t0;
      if (t >= total) break;
      await r.prepareFor(t);
      // 次のスライドを先に用意しておく（録画中に止まらないように）
      r.prefetch(Math.min(total, t + 2500));
      await r.draw(t);
      onProgress({ ratio: t / total, remainingSec: (total - t) / 1000 });
      await new Promise((ok) => requestAnimationFrame(() => ok(null)));
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    stopSound();
    stream.getTracks().forEach((tr) => tr.stop());
    video.getTracks().forEach((tr) => tr.stop());
  }
  await stopped;
  const type = mime.split(';')[0];
  return {
    blob: new Blob(chunks, { type }),
    mime: type,
    ext: type === 'video/mp4' ? 'mp4' : 'webm',
    durationSec: total / 1000,
    audioIncluded: !!audio,
  };
}

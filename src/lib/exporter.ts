import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { loadFile, thumbKey } from '../data/repository';
import { drawCover, featherMask } from './circleDraw';
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

/* 思い出ムービーを動画ファイル（MP4）にする。
 *
 * 画面の再生と同じ見た目を、見えないキャンバスに1コマずつ描き直して動画にする。
 * - スマホの動画変換機能（WebCodecs）が使えれば、実時間より速く作れる
 * - 使えなければ、キャンバスを実時間で録画する（動画の長さと同じだけ時間がかかる）
 *
 * 画面の再生は CSS のアニメーションで動いているので、ここでは同じ動き
 * （フェード・漂い・光の粒・字幕）を計算で再現している。 */

/** 動画の論理サイズ（スマホの画面と同じくらい）。実際の画素数は SCALE 倍 */
const LW = 360;
const LH = 640;
const SCALE = 2; // → 720 × 1280
const W = LW * SCALE;
const H = LH * SCALE;
const FPS = 30;
/** 画質（ビット毎秒）。ゆっくり動く映像なので控えめでもきれい。ファイルを小さくして共有しやすくする */
const BITRATE = 3_000_000;
const OPEN_MS = 700; // 最初の黒からのフェード
const TAIL_MS = 600; // 最後の余韻

export interface ExportProgress {
  /** 0〜1 */
  ratio: number;
  /** 残り時間の目安（秒）。わからないときは undefined */
  remainingSec?: number;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  /** 音（BGM・動画の音）が入ったか */
  audioIncluded: boolean;
}

export interface ExportOptions {
  slides: Slide[];
  showDate: boolean;
  bgm: BgmChoice;
  /**
   * 実時間で録画するときに使う音の出口。iPhone ではボタンを押したその場で作る必要があるので、
   * 画面側で createExportAudioContext() を呼んで渡す。
   */
  audioCtx?: AudioContext;
  onProgress: (p: ExportProgress) => void;
  signal: AbortSignal;
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

function parseRgb(c: string): [number, number, number] {
  const m = c.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [255, 220, 170];
}
const mixRgb = (a: string, b: string, t: number) => {
  const x = parseRgb(a);
  const y = parseRgb(b);
  return `rgb(${[0, 1, 2].map((i) => Math.round(lerp(x[i], y[i], t))).join(',')})`;
};

// ---------------------------------------------------------------- 素材の準備

interface Prepared {
  placement: Placement;
  palette: Palette;
  /** ぼかした写真などで作った背景（全画面） */
  bg: HTMLCanvasElement;
  /** 丸く切り抜いた写真（写真のとき） */
  circle?: HTMLCanvasElement;
  video?: HTMLVideoElement;
  videoUrl?: string;
  /** 動画のコマを描くための作業用キャンバス */
  videoCanvas?: HTMLCanvasElement;
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
function renderBackground(photo: CanvasImageSource | undefined, pw: number, ph: number, pal: Palette): HTMLCanvasElement {
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

async function prepare(slide: Slide): Promise<Prepared> {
  const placement = place(slide.key, LW, LH);
  const px = Math.round(placement.d * SCALE);
  const media = slide.media;
  const thumbBlob = media && !media.missing && media.hasThumb ? await loadFile(thumbKey(media.id)) : null;

  if (media?.kind === 'photo' && !media.missing) {
    const blob = await loadFile(media.id);
    if (blob) {
      const img = await toBitmap(blob);
      const [w, h] = sizeOf(img);
      const palette = extractPalette(img);
      const circle = canvas(px, px);
      const cctx = circle.getContext('2d')!;
      drawCover(cctx, img, w, h, px);
      featherMask(cctx, px);
      const bg = renderBackground(img, w, h, palette);
      if ('close' in img) img.close();
      return { placement, palette, bg, circle, missing: false, dispose: () => {} };
    }
  }

  if (media?.kind === 'video' && !media.missing) {
    const blob = await loadFile(media.id);
    if (blob) {
      const videoUrl = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = videoUrl;
      await new Promise<void>((ok) => {
        video.onloadeddata = () => ok();
        video.onerror = () => ok();
        setTimeout(ok, 8000);
      });
      let palette = DEFAULT_PALETTE;
      let bgSrc: CanvasImageSource | undefined;
      let bw = 0;
      let bh = 0;
      if (thumbBlob) {
        const t = await toBitmap(thumbBlob);
        palette = extractPalette(t);
        [bw, bh] = sizeOf(t);
        bgSrc = t;
      }
      const bg = renderBackground(bgSrc, bw, bh, palette);
      if (bgSrc && 'close' in bgSrc) (bgSrc as ImageBitmap).close();
      return {
        placement,
        palette,
        bg,
        video,
        videoUrl,
        videoCanvas: canvas(px, px),
        missing: !video.videoWidth,
        dispose: () => {
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(videoUrl);
        },
      };
    }
  }

  // 写真のない記録・見つからない写真
  return { placement, palette: DEFAULT_PALETTE, bg: renderBackground(undefined, 0, 0, DEFAULT_PALETTE), missing: !!media, dispose: () => {} };
}

/** 動画の指定の時刻のコマに合わせる */
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
  readonly canvas = canvas(W, H);
  private ctx = this.canvas.getContext('2d')!;
  private prepared = new Map<number, Promise<Prepared>>();
  private ready = new Map<number, Prepared>();
  timing: Timing;

  constructor(
    private slides: Slide[],
    private showDate: boolean,
  ) {
    this.timing = schedule(slides, new Map());
  }

  /** 動画の長さがわかったら、タイミングを決め直す */
  async measureVideos() {
    const secs = new Map<number, number>();
    for (let i = 0; i < this.slides.length; i++) {
      const s = this.slides[i];
      if (s.media?.kind !== 'video' || s.media.missing) continue;
      const p = await this.need(i);
      if (p.video?.duration && isFinite(p.video.duration)) secs.set(i, p.video.duration);
      this.release(i);
    }
    this.timing = schedule(this.slides, secs);
  }

  need(i: number): Promise<Prepared> {
    let p = this.prepared.get(i);
    if (!p) {
      p = prepare(this.slides[i]).then((r) => {
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
    const { start, dwell } = this.timing;
    const last = this.slides.length - 1;
    const visible: number[] = [];
    let current = 0;
    for (let i = 0; i <= last; i++) {
      if (start[i] <= t) current = i;
      const end = start[i] + dwell[i] + (i === last ? FADE_MS : 0);
      if (start[i] <= t && t < end) visible.push(i);
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

  /** t（ミリ秒）のコマを描く。動画はそのコマに合わせてから描く */
  async draw(t: number) {
    const ctx = this.ctx;
    const { start, dwell, total } = this.timing;
    const { visible, current } = this.active(t);
    const last = this.slides.length - 1;

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

    // 光の粒（写真の色で、色もゆっくり移り変わる）
    const pal1 = curBg?.palette ?? DEFAULT_PALETTE;
    const pal0 = prevBg?.palette ?? pal1;
    const colA = mixRgb(pal0.glow1, pal1.glow1, bgAlpha);
    const colB = mixRgb(pal0.glow2, pal1.glow2, bgAlpha);
    this.drawMotes(t / 1000, colA, colB);

    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    // タグ（上に小さく）
    const curSlide = this.slides[current];
    if (curSlide.memory.tags.length) {
      // 同じ記録が続いている間は出したまま、記録が変わったらフェードイン
      let j = current;
      while (j > 0 && this.slides[j - 1].memory.id === curSlide.memory.id) j--;
      const since = t - start[j];
      ctx.globalAlpha = ease(clamp01(since / 1600));
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      setSpacing(ctx, 0.5);
      shadowText(ctx, curSlide.memory.tags.map((x) => `#${x}`).join('  '), LW / 2, 68, '#e6d9c8', 'rgba(0,0,0,0.8)', 10);
      ctx.globalAlpha = 1;
    }

    // 写真（重なっている間は2枚）
    for (const i of visible) {
      const p = this.ready.get(i);
      if (!p) continue;
      const nextStart = i < last ? start[i + 1] : start[i] + dwell[i];
      const fadeIn = ease(clamp01((t - start[i]) / FADE_MS));
      const fadeOut = t >= nextStart ? 1 - ease(clamp01((t - nextStart) / FADE_MS)) : 1;
      const opacity = Math.min(fadeIn, fadeOut);
      if (opacity <= 0) continue;
      await this.drawSlide(i, p, t, opacity, Math.min(t, nextStart));
    }

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

  private drawMotes(sec: number, colA: string, colB: string) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    MOTES.forEach((m, k) => {
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
      const R = size * Math.SQRT1_2 * sc;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, '#fff8ec');
      g.addColorStop(0.22, k % 2 === 0 ? colA : colB);
      g.addColorStop(0.7, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  private async drawSlide(i: number, p: Prepared, t: number, opacity: number, mediaClock: number) {
    const ctx = this.ctx;
    const slide = this.slides[i];
    const { start } = this.timing;
    const pl = p.placement;
    const local = t - start[i];

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

    // 写真・動画・文字
    if (p.circle) {
      ctx.drawImage(p.circle, pl.x, pl.y, pl.d, pl.d);
    } else if (p.video && p.videoCanvas && !p.missing) {
      await seek(p.video, (mediaClock - start[i]) / 1000);
      const vc = p.videoCanvas;
      const vctx = vc.getContext('2d')!;
      drawCover(vctx, p.video, p.video.videoWidth, p.video.videoHeight, vc.width);
      featherMask(vctx, vc.width);
      ctx.drawImage(vc, pl.x, pl.y, pl.d, pl.d);
    } else {
      this.drawTextCircle(pl, p.missing ? '画像が見つかりません' : slide.memory.text);
    }

    // 字幕（日付とコメント）：写真より少し遅れてふわっと
    const hasComment = !!slide.comment && !!slide.media;
    if (hasComment || this.showDate) {
      const k = ease(clamp01((local - COMMENT_DELAY_MS) / COMMENT_FADE_MS));
      if (k > 0) {
        ctx.globalAlpha = opacity * k;
        const left = pl.x + pl.commentLeft;
        const centerX = left + pl.commentWidth / 2;
        let y = pl.y + pl.d * 0.92 - 6 + (1 - k) * 8;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (this.showDate) {
          ctx.font = `12px ${FONT}`;
          setSpacing(ctx, 1.4);
          shadowText(ctx, formatDot(slide.date), centerX, y + 2, 'rgba(255,246,232,0.62)', 'rgba(0,0,0,0.8)', 10);
          y += 12 * 1.6 + 2;
        }
        if (hasComment) {
          ctx.font = `16px ${FONT}`;
          setSpacing(ctx, 0);
          const lh = 16 * 1.75;
          wrap(ctx, slide.comment, pl.commentWidth, 4).forEach((line, n) =>
            shadowText(ctx, line, centerX, y + n * lh + (lh - 16) / 2, '#fbf3e6', 'rgba(0,0,0,0.85)', 12),
          );
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 写真のない記録：丸い淡い光の中に文字 */
  private drawTextCircle(pl: Placement, text: string) {
    const ctx = this.ctx;
    const r = pl.d / 2;
    const cx = pl.x + r;
    const cy = pl.y + r;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * Math.SQRT2);
    g.addColorStop(0, 'rgba(255,230,190,0.16)');
    g.addColorStop(0.55, 'rgba(255,230,190,0.06)');
    g.addColorStop(0.72, 'rgba(255,230,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `17px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(ctx, text, pl.d * 0.64, 6);
    const lh = 17 * 1.8;
    lines.forEach((line, n) => shadowText(ctx, line, cx, cy + (n - (lines.length - 1) / 2) * lh, '#f8eedf', 'rgba(0,0,0,0.6)', 16));
  }

  dispose() {
    for (const i of [...this.prepared.keys()]) this.release(i);
  }
}

// ---------------------------------------------------------------- 動画にする

const H264 = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

async function pickCodec(): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of H264) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: BITRATE, framerate: FPS });
      if (r.supported) return codec;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

interface AudioCodec {
  /** WebCodecs の名前 */
  codec: string;
  /** mp4-muxer の名前 */
  mux: 'aac' | 'opus';
}

async function pickAudioCodec(): Promise<AudioCodec | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const cands: AudioCodec[] = [{ codec: 'mp4a.40.2', mux: 'aac' }];
  // 動作確認用（iPhone で再生しにくい形式なので、普段は使わない）
  if ((globalThis as unknown as { __meguruTestOpus?: boolean }).__meguruTestOpus) cands.push({ codec: 'opus', mux: 'opus' });
  for (const c of cands) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 128_000 });
      if (r.supported) return c;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

const canRecordRealtime = () => typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

/**
 * 書き出しの方法（画面に出す説明用）。
 * withSound：BGM や動画の音を入れるか
 */
export async function exportMethod(withSound: boolean): Promise<'fast' | 'realtime' | 'none'> {
  const v = await pickCodec();
  if (v && (!withSound || (await pickAudioCodec()))) return 'fast';
  if (canRecordRealtime()) return 'realtime';
  if (v) return 'fast';
  return 'none';
}

export async function exportMovie({ slides, showDate, bgm, audioCtx, onProgress, signal }: ExportOptions): Promise<ExportResult> {
  const r = new Renderer(slides, showDate);
  try {
    await r.measureVideos();
    const sound = await buildSoundtrack(slides, r.timing, bgm);
    const withSound = hasSound(sound);
    const vcodec = await pickCodec();
    const acodec = withSound ? await pickAudioCodec() : null;
    if (vcodec && (!withSound || acodec)) return await encodeFast(r, vcodec, withSound ? { sound, codec: acodec! } : null, onProgress, signal);
    if (canRecordRealtime()) return await recordRealtime(r, withSound && audioCtx ? { sound, ctx: audioCtx } : null, onProgress, signal);
    if (vcodec) return await encodeFast(r, vcodec, null, onProgress, signal); // 音なしで書き出す
    throw new Error('この端末・ブラウザは動画の書き出しに対応していません');
  } finally {
    r.dispose();
  }
}

const abortError = () => new DOMException('中止しました', 'AbortError');

/** WebCodecs：1コマずつ描いて変換（実時間より速い） */
async function encodeFast(
  r: Renderer,
  codec: string,
  audio: { sound: Soundtrack; codec: AudioCodec } | null,
  onProgress: ExportOptions['onProgress'],
  signal: AbortSignal,
): Promise<ExportResult> {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    ...(audio ? { audio: { codec: audio.codec.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
    fastStart: 'in-memory',
  });
  let failure: unknown;

  // 音：20秒ずつ演奏して変換する（メモリを使いすぎないように）
  const AUDIO_SHARE = audio ? 0.08 : 0; // 進み具合のうち、音の分
  if (audio) {
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (failure = e),
    });
    aenc.configure({ codec: audio.codec.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 128_000 });
    const total = r.timing.total;
    const CHUNK = 20_000;
    for (let from = 0; from < total; from += CHUNK) {
      if (signal.aborted) {
        aenc.close();
        throw abortError();
      }
      const to = Math.min(total, from + CHUNK);
      const buf = await renderSound(audio.sound, from, to);
      const planar = new Float32Array(buf.length * 2);
      planar.set(buf.getChannelData(0), 0);
      planar.set(buf.getChannelData(1), buf.length);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: buf.length,
        numberOfChannels: 2,
        timestamp: Math.round(from * 1000),
        data: planar,
      });
      aenc.encode(data);
      data.close();
      onProgress({ ratio: AUDIO_SHARE * (to / total) });
    }
    await aenc.flush();
    aenc.close();
    if (failure) throw failure;
  }

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure({ codec, width: W, height: H, bitrate: BITRATE, framerate: FPS, avc: { format: 'avc' } });

  const frames = Math.ceil((r.timing.total / 1000) * FPS);
  const began = performance.now();
  for (let n = 0; n < frames; n++) {
    if (signal.aborted) {
      encoder.close();
      throw abortError();
    }
    if (failure) throw failure;
    const t = (n * 1000) / FPS;
    await r.prepareFor(t);
    await r.draw(t);
    const frame = new VideoFrame(r.canvas, { timestamp: Math.round((n * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(frame, { keyFrame: n % (FPS * 2) === 0 });
    frame.close();
    // 変換が追いつくまで少し待つ（メモリを使いすぎないように）
    while (encoder.encodeQueueSize > 6) await new Promise((ok) => setTimeout(ok, 4));
    if (n % 5 === 0 || n === frames - 1) {
      const vr = (n + 1) / frames;
      const elapsed = (performance.now() - began) / 1000;
      onProgress({ ratio: AUDIO_SHARE + (1 - AUDIO_SHARE) * vr, remainingSec: n > FPS ? (elapsed / vr) * (1 - vr) : undefined });
      await new Promise((ok) => setTimeout(ok, 0)); // 画面の更新をはさむ
    }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return {
    blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
    mime: 'video/mp4',
    ext: 'mp4',
    durationSec: r.timing.total / 1000,
    audioIncluded: !!audio,
  };
}

/** MediaRecorder：描いたキャンバスを実時間で録画（変換機能がない端末用） */
async function recordRealtime(
  r: Renderer,
  audio: { sound: Soundtrack; ctx: AudioContext } | null,
  onProgress: ExportOptions['onProgress'],
  signal: AbortSignal,
): Promise<ExportResult> {
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

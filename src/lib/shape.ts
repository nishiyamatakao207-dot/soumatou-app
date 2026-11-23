import { drawCover, featherMask } from './circleDraw';
import { seeded } from './movie';

/* 再生するときの写真の形。画面の再生・設定の見本・動画の書き出しで、同じ描き方を使う。
 * どの形も、正方形のキャンバス（一辺 size）の中に描く。 */

export type PhotoShape = 'circle' | 'square' | 'rounded' | 'egg' | 'polaroid';

export const SHAPE_OPTIONS: { value: PhotoShape; label: string }[] = [
  { value: 'circle', label: '丸' },
  { value: 'square', label: '四角' },
  { value: 'rounded', label: '角丸四角' },
  { value: 'egg', label: 'たまご形' },
  { value: 'polaroid', label: 'ポラロイド風' },
];

/** 字幕を出す高さ（写真の箱の高さに対する割合）。写真の見えている下のふちのすぐ下 */
export const CAPTION_TOP: Record<PhotoShape, number> = {
  circle: 0.92,
  square: 0.94,
  rounded: 0.94,
  egg: 0.93,
  polaroid: 0.99,
};

/** ポラロイド風：写真ごとの傾き（左右に2〜5度）。同じ写真はいつも同じ傾き */
export function tiltFor(key: string): number {
  const rnd = seeded(`tilt-${key}`);
  const deg = 2 + rnd() * 3;
  return ((rnd() < 0.5 ? -1 : 1) * deg * Math.PI) / 180;
}

// ---------------------------------------------------------------- ふちのぼかし

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** 丸と同じ、中心からの距離によるぼかし方（なだらかに外へ透明になる） */
function radialFalloff(r: number): number {
  const stops: [number, number][] = [
    [0.55, 1],
    [0.7, 0.86],
    [0.82, 0.5],
    [0.92, 0.16],
    [1, 0],
  ];
  if (r <= stops[0][0]) return 1;
  for (let i = 1; i < stops.length; i++) {
    const [r1, a1] = stops[i];
    const [r0, a0] = stops[i - 1];
    if (r <= r1) return a0 + ((a1 - a0) * (r - r0)) / (r1 - r0);
  }
  return 0;
}

/** 四角・角丸四角のぼかし幅（一辺に対する割合） */
const EDGE = 0.16;

/** 形ごとの「透明さの型紙」を作る（大きさごとに1回だけ作って使い回す） */
const maskCache = new Map<string, HTMLCanvasElement>();

function maskFor(shape: Exclude<PhotoShape, 'circle' | 'polaroid'>, size: number): HTMLCanvasElement {
  const key = `${shape}@${size}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  const R = size * 0.2; // 角丸の半径
  const rx = size * 0.38; // たまご形（縦長の楕円）
  const ry = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      let a: number;
      if (shape === 'egg') {
        a = radialFalloff(Math.sqrt((px / rx) ** 2 + (py / ry) ** 2));
      } else {
        // 外側のふちから内側へ何ピクセル入っているか
        let inside: number;
        if (shape === 'square') {
          inside = half - Math.max(Math.abs(px), Math.abs(py));
        } else {
          const qx = Math.abs(px) - (half - R);
          const qy = Math.abs(py) - (half - R);
          const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
          inside = -outside;
        }
        a = smooth(inside / (size * EDGE));
      }
      img.data[(y * size + x) * 4 + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  if (maskCache.size > 24) maskCache.clear();
  maskCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- 描く

/** 写真を枠の中に「切り抜き」で描く（顔が入りやすいよう少し上寄り） */
function coverInto(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, x: number, y: number, bw: number, bh: number) {
  const s = Math.max(bw / w, bh / h);
  const dw = w * s;
  const dh = h * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, bw, bh);
  ctx.clip();
  ctx.drawImage(src, x + (bw - dw) / 2, y + (bh - dh) * 0.4, dw, dh);
  ctx.restore();
}

/** ポラロイド風：白いフチ（下だけ太め）、ぼかさず、下にやわらかい影。少し傾ける */
function drawPolaroid(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, size: number, tilt: number) {
  const W = size * 0.8;
  const m = W * 0.06; // 上・左右のフチ
  const mb = m * 3.2; // 下のフチ
  const photo = W - m * 2;
  const H = m + photo + mb;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(tilt);
  // 影（フチの下に、浮いているように）
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = size * 0.05;
  ctx.shadowOffsetY = size * 0.025;
  const paper = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
  paper.addColorStop(0, '#fbf9f4');
  paper.addColorStop(1, '#efe9de');
  ctx.fillStyle = paper;
  ctx.fillRect(-W / 2, -H / 2, W, H);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // 写真
  coverInto(ctx, src, w, h, -W / 2 + m, -H / 2 + m, photo, photo);
  // 写真のふちに、ごく薄い影（紙に貼ったような立体感）
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = Math.max(1, size * 0.002);
  ctx.strokeRect(-W / 2 + m, -H / 2 + m, photo, photo);
  ctx.restore();
}

/**
 * 写真（または動画の1コマ）を、選んだ形で正方形のキャンバスに描く。
 * key：写真ごとの値（ポラロイド風の傾きに使う）
 */
export function drawShaped(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  w: number,
  h: number,
  size: number,
  shape: PhotoShape,
  key: string,
) {
  if (shape === 'polaroid') return drawPolaroid(ctx, src, w, h, size, tiltFor(key));
  drawCover(ctx, src, w, h, size);
  if (shape === 'circle') return featherMask(ctx, size);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskFor(shape, size), 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

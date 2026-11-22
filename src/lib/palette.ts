/* 写真から色合いを取り出して、背景の色に使う */

export interface Palette {
  /** 背景の地の色（暗め） */
  base: string;
  /** 光の色 2つ */
  glow1: string;
  glow2: string;
}

export const DEFAULT_PALETTE: Palette = { base: 'rgb(26,18,12)', glow1: 'rgb(255,206,140)', glow2: 'rgb(214,150,110)' };

type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB;
const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

function hsv([r, g, b]: RGB) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max / 255 };
}

/** 小さく縮めた画像の色を、色相ごとに集計して代表色を選ぶ */
export function extractPalette(src: CanvasImageSource): Palette {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return DEFAULT_PALETTE;
  ctx.drawImage(src, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let ar = 0, ag = 0, ab = 0;
  for (let i = 0; i < px.length; i += 4) {
    const rgb: RGB = [px[i], px[i + 1], px[i + 2]];
    ar += rgb[0];
    ag += rgb[1];
    ab += rgb[2];
    const { h, s, v } = hsv(rgb);
    const w = s * v + 0.02;
    const bk = buckets[Math.floor(h / 30) % 12];
    bk.w += w;
    bk.r += rgb[0] * w;
    bk.g += rgb[1] * w;
    bk.b += rgb[2] * w;
  }
  const n = px.length / 4;
  const avg: RGB = [ar / n, ag / n, ab / n];
  const top = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const color = (b?: (typeof top)[number]): RGB => (b ? [b.r / b.w, b.g / b.w, b.b / b.w] : avg);
  const c1 = color(top[0]);
  const c2 = top[1] && top[1].w > top[0].w * 0.15 ? color(top[1]) : mix(c1, avg, 0.5);
  // 光は明るく、地は暗く
  const bright = (x: RGB) => {
    const m = Math.max(...x, 1);
    return mix(x.map((v) => (v / m) * 255) as RGB, [255, 255, 255], 0.18);
  };
  return { base: css(mix(avg, [8, 6, 10], 0.72)), glow1: css(bright(c1)), glow2: css(bright(c2)) };
}

/* 丸く切り抜いて、ふちを外へ向かってふんわり透明にする描き方（再生と書き出しで共通） */

/** 中心からの距離に応じた透明度（くっきりした輪郭が出ないよう、なだらかに） */
export function featherMask(ctx: CanvasRenderingContext2D, size: number) {
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,1)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.86)');
  g.addColorStop(0.82, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.92, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
}

/** 正方形に「切り抜き」（顔が入りやすいよう少し上寄り） */
export function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, size: number) {
  const s = Math.max(size / w, size / h);
  const dw = w * s;
  const dh = h * s;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(src, (size - dw) / 2, (size - dh) * 0.4, dw, dh);
}


import { useEffect, useRef } from 'react';

/**
 * 四辺をふわっと透明にぼかした写真。
 * ブラウザの「マスク」機能は機種によって写真ごと消えてしまうことがあるため、
 * キャンバスに自分で描いて、どの端末でも同じ見た目にする。
 */
export function FeatherImage({ src, maxW, maxH, feather = 0.09 }: { src: string; maxW: number; maxH: number; feather?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (cancelled || !canvas || !img.naturalWidth) return;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 4);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, 0, 0, cw, ch);
      // 横方向と縦方向のグラデーションで、ふちだけ透明にしていく
      ctx.globalCompositeOperation = 'destination-in';
      const gx = ctx.createLinearGradient(0, 0, cw, 0);
      gx.addColorStop(0, 'rgba(0,0,0,0)');
      gx.addColorStop(feather, 'rgba(0,0,0,1)');
      gx.addColorStop(1 - feather, 'rgba(0,0,0,1)');
      gx.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gx;
      ctx.fillRect(0, 0, cw, ch);
      const gy = ctx.createLinearGradient(0, 0, 0, ch);
      gy.addColorStop(0, 'rgba(0,0,0,0)');
      gy.addColorStop(feather, 'rgba(0,0,0,1)');
      gy.addColorStop(1 - feather, 'rgba(0,0,0,1)');
      gy.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gy;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, maxW, maxH, feather]);

  return <canvas ref={ref} className="flow-photo" />;
}

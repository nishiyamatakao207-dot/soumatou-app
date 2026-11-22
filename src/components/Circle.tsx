import { useEffect, useRef } from 'react';

/* 写真・動画を丸く切り抜き、ふちを外へ向かってふんわり透明にする。
 * ブラウザのマスク機能は機種差があるため、キャンバスに自分で描く。 */

/** 中心からの距離に応じた透明度（くっきりした輪郭が出ないよう、なだらかに） */
function featherMask(ctx: CanvasRenderingContext2D, size: number) {
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
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, size: number) {
  const s = Math.max(size / w, size / h);
  const dw = w * s;
  const dh = h * s;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(src, (size - dw) / 2, (size - dh) * 0.4, dw, dh);
}

const pixelSize = (d: number) => Math.round(d * Math.min(2, window.devicePixelRatio || 1));

export function CircleImage({ src, diameter, onLoad }: { src: string; diameter: number; onLoad?: (img: HTMLImageElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (cancelled || !c || !ctx || !img.naturalWidth) return;
      const size = pixelSize(diameter);
      c.width = c.height = size;
      drawCover(ctx, img, img.naturalWidth, img.naturalHeight, size);
      featherMask(ctx, size);
      onLoadRef.current?.(img);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, diameter]);
  return <canvas ref={ref} className="circle" style={{ width: diameter, height: diameter }} />;
}

/**
 * 動画も丸く。見えない <video> を再生し、そのコマを丸いキャンバスに描き続ける。
 */
export function CircleVideo({
  src,
  diameter,
  playing,
  muted,
  onDuration,
  onEnded,
}: {
  src: string;
  diameter: number;
  playing: boolean;
  muted: boolean;
  onDuration?: (sec: number) => void;
  onEnded?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // コマを描き続ける（再生中だけ）
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!v || !c || !ctx) return;
    const size = pixelSize(diameter);
    c.width = c.height = size;
    let stop = false;
    let handle = 0;
    const draw = () => {
      if (stop) return;
      if (v.videoWidth) {
        drawCover(ctx, v, v.videoWidth, v.videoHeight, size);
        featherMask(ctx, size);
      }
      schedule();
    };
    const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
    const schedule = () => {
      handle = vv.requestVideoFrameCallback ? vv.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };
    v.addEventListener('loadeddata', draw, { once: true });
    v.addEventListener('seeked', draw);
    schedule();
    return () => {
      stop = true;
      v.removeEventListener('seeked', draw);
      if (vv.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [diameter, src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      return;
    }
    v.muted = muted;
    v.play().catch(() => {
      // 音ありの自動再生が止められたら消音で再生
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [playing, muted, src]);

  return (
    <>
      <canvas ref={canvasRef} className="circle" style={{ width: diameter, height: diameter }} />
      <video
        ref={videoRef}
        className="circle-source"
        src={src}
        playsInline
        muted={muted}
        preload="auto"
        onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
        onEnded={onEnded}
        onError={onEnded}
      />
    </>
  );
}

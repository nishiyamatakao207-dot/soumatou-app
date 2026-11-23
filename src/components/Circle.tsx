import { useEffect, useRef } from 'react';
import { drawShaped, type PhotoShape } from '../lib/shape';

/* 写真・動画を丸く切り抜き、ふちを外へ向かってふんわり透明にする。
 * ブラウザのマスク機能は機種差があるため、キャンバスに自分で描く。 */

const pixelSize = (d: number) => Math.round(d * Math.min(2, window.devicePixelRatio || 1));

export function CircleImage({
  src,
  diameter,
  shape = 'circle',
  shapeKey = '',
  onLoad,
}: {
  src: string;
  diameter: number;
  /** 写真の形（設定で選んだもの） */
  shape?: PhotoShape;
  /** 写真ごとの値（ポラロイド風の傾き） */
  shapeKey?: string;
  onLoad?: (img: HTMLImageElement) => void;
}) {
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
      drawShaped(ctx, img, img.naturalWidth, img.naturalHeight, size, shape, shapeKey);
      onLoadRef.current?.(img);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, diameter, shape, shapeKey]);
  return <canvas ref={ref} className="circle" style={{ width: diameter, height: diameter }} />;
}

/**
 * 動画も丸く。見えない <video> を再生し、そのコマを丸いキャンバスに描き続ける。
 */
export function CircleVideo({
  src,
  diameter,
  shape = 'circle',
  shapeKey = '',
  playing,
  muted,
  onDuration,
  onEnded,
}: {
  src: string;
  diameter: number;
  shape?: PhotoShape;
  shapeKey?: string;
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
        drawShaped(ctx, v, v.videoWidth, v.videoHeight, size, shape, shapeKey);
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
  }, [diameter, src, shape, shapeKey]);

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

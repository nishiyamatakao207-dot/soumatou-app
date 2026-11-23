import { useEffect, useRef, useState } from 'react';
import { listDatedItems, loadFile, thumbKey } from '../data/repository';
import { SHAPE_OPTIONS, drawShaped, type PhotoShape } from '../lib/shape';
import { useSetting } from '../lib/settings';

/** 見本に使う絵：いちばん新しい写真。なければ、夕焼けの絵を描いて使う */
async function sampleImage(): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    const items = await listDatedItems();
    const last = [...items].reverse().find((it) => it.media?.kind === 'photo' && it.media.hasThumb && !it.media.missing);
    if (last?.media) {
      const blob = await loadFile(thumbKey(last.media.id));
      if (blob) return await createImageBitmap(blob);
    }
  } catch {
    /* 見本の絵を使う */
  }
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 300;
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#f3a36b');
  sky.addColorStop(0.6, '#f7d39a');
  sky.addColorStop(1, '#8fb07a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 300, 300);
  ctx.fillStyle = '#fff3d6';
  ctx.beginPath();
  ctx.arc(170, 150, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5f8a5a';
  ctx.beginPath();
  ctx.moveTo(0, 220);
  ctx.quadraticCurveTo(90, 170, 170, 215);
  ctx.quadraticCurveTo(240, 250, 300, 205);
  ctx.lineTo(300, 300);
  ctx.lineTo(0, 300);
  ctx.fill();
  return c;
}

function Preview({ src, shape }: { src: CanvasImageSource & { width: number; height: number }; shape: PhotoShape }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const size = Math.round(84 * Math.min(2, window.devicePixelRatio || 1));
    c.width = c.height = size;
    drawShaped(ctx, src, src.width, src.height, size, shape, 'sample');
  }, [src, shape]);
  return <canvas ref={ref} className="shape-canvas" />;
}

/** 設定：再生するときの写真の形を、見本を見ながら選ぶ */
export function ShapePicker() {
  const [shape, setShape] = useSetting('photoShape');
  const [src, setSrc] = useState<(CanvasImageSource & { width: number; height: number }) | null>(null);
  useEffect(() => {
    sampleImage().then(setSrc);
  }, []);
  return (
    <div className="shape-picker">
      <span className="bgm-label">再生するときの写真の形</span>
      <div className="shape-grid" role="radiogroup" aria-label="写真の形">
        {SHAPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={shape === o.value}
            className={`shape-tile ${shape === o.value ? 'on' : ''}`}
            onClick={() => setShape(o.value)}
          >
            <span className="shape-stage">{src && <Preview src={src} shape={o.value} />}</span>
            <span className="shape-name">{o.label}</span>
          </button>
        ))}
      </div>
      <p className="bgm-note">動画にするときも、この形になります。</p>
    </div>
  );
}

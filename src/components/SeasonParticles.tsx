import { particles, type Season } from '../lib/season';

/**
 * 季節の粒（花びら・ほたる・紅葉・雪）。動きは CSS のアニメーションだけで行うので軽い。
 * height：この層の高さ（px）。落ちる距離に使う。省略すると画面の高さ。
 */
export function SeasonParticles({ season, count, height }: { season: Season; count?: number; height?: number }) {
  const list = particles(season, count);
  return (
    <div className={`season-layer season-${season}`} style={{ ['--H' as string]: height ? `${height}px` : '100vh' }} aria-hidden="true">
      {list.map((p, i) => {
        const vars = {
          left: `${p.left.toFixed(1)}%`,
          ['--fall' as string]: `${p.fall.toFixed(2)}s`,
          ['--delay' as string]: `${p.delay.toFixed(2)}s`,
          ['--drift' as string]: `${p.drift.toFixed(0)}px`,
          ['--spin' as string]: `${p.spin.toFixed(0)}deg`,
          ['--top' as string]: `${p.top.toFixed(1)}%`,
          ['--fx' as string]: `${(p.drift / 3).toFixed(0)}px`,
          ['--fy' as string]: `${(-p.drift / 5).toFixed(0)}px`,
        } as React.CSSProperties;
        const inner = {
          width: p.size,
          height: p.kind === 'petal' ? p.size * 0.62 : p.kind === 'leaf' ? p.size * 0.8 : p.size,
          color: p.color,
          ['--sway' as string]: `${p.sway.toFixed(2)}s`,
          ['--swayPx' as string]: `${p.swayPx.toFixed(0)}px`,
          ['--blink' as string]: `${p.blink.toFixed(2)}s`,
        } as React.CSSProperties;
        return (
          <div key={i} className={`sp ${p.kind === 'firefly' ? 'float' : 'fall'}`} style={vars}>
            <div className={`sp-in ${p.kind}`} style={inner} />
          </div>
        );
      })}
    </div>
  );
}

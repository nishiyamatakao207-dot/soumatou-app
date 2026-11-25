import { useRef, useState } from 'react';
import { monthLabel } from '../../lib/entries';

/**
 * 画面の右端の、年・月のスクロールバー。指でなぞると、その位置の月へ一気に移動する。
 * months：新しい月から順（一覧の並びと同じ）
 */
export function MonthScrubber({ months, current, onJump }: { months: string[]; current?: string; onJump: (key: string) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; y: number } | null>(null);
  const last = useRef<string>('');

  const at = (clientY: number) => {
    const r = rail.current!.getBoundingClientRect();
    const ratio = Math.min(0.9999, Math.max(0, (clientY - r.top) / r.height));
    const key = months[Math.floor(ratio * months.length)];
    setDrag({ key, y: clientY - r.top });
    if (key !== last.current) {
      last.current = key;
      onJump(key);
    }
  };

  // 年の目盛り（その年のいちばん新しい月の位置に）
  const marks: { year: string; top: number }[] = [];
  months.forEach((k, i) => {
    const y = k.slice(0, 4);
    if (marks.at(-1)?.year !== y) marks.push({ year: y, top: (i / months.length) * 100 });
  });
  const curIndex = current ? months.indexOf(current) : -1;

  return (
    <div
      ref={rail}
      className={`scrubber ${drag ? 'active' : ''}`}
      aria-label="年・月のスクロールバー"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = '';
        at(e.clientY);
      }}
      onPointerMove={(e) => drag && at(e.clientY)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      {marks.map((m) => (
        <span key={m.year} className="scrubber-year" style={{ top: `${m.top}%` }}>
          {m.year.slice(2)}
        </span>
      ))}
      {curIndex >= 0 && !drag && <span className="scrubber-thumb" style={{ top: `${((curIndex + 0.5) / months.length) * 100}%` }} />}
      {drag && (
        <span className="scrubber-bubble" style={{ top: drag.y }}>
          {monthLabel(drag.key)}
        </span>
      )}
    </div>
  );
}

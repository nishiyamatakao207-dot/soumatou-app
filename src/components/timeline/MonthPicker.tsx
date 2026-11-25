import { useEffect, useRef } from 'react';
import { monthLabel } from '../../lib/entries';

/** 年・月の一覧から選んで移動する（記録がある月だけ。件数つき） */
export function MonthPicker({
  months,
  current,
  onPick,
  onClose,
}: {
  /** 'YYYY-MM' と件数（新しい月から） */
  months: { key: string; count: number }[];
  current?: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const years = [...new Set(months.map((m) => m.key.slice(0, 4)))];
  const cur = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cur.current?.scrollIntoView({ block: 'center' });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="month-picker" role="dialog" aria-label="年・月を選んで移動" onClick={onClose}>
      <div className="month-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="month-sheet-head">
          <strong>年・月を選んで移動</strong>
          <button className="btn ghost small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="month-sheet-body">
          {years.map((y) => (
            <section key={y}>
              <h3>{y}年</h3>
              <div className="month-grid">
                {months
                  .filter((m) => m.key.startsWith(y))
                  .map((m) => (
                    <button
                      key={m.key}
                      ref={m.key === current ? cur : undefined}
                      className={`month-cell ${m.key === current ? 'on' : ''}`}
                      onClick={() => onPick(m.key)}
                    >
                      {monthLabel(m.key).replace(/^\d+年/, '')}
                      <small>{m.count}件</small>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

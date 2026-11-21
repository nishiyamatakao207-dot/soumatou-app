import { PERIOD_LABELS, type FilterState, type PeriodKey } from '../lib/filter';

/** タグと期間の絞り込み。一覧と走馬灯で同じ条件を使う */
export function FilterBar({ value, onChange, tags }: { value: FilterState; onChange: (f: FilterState) => void; tags: string[] }) {
  const toggle = (t: string) =>
    onChange({ ...value, tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] });

  return (
    <div className="filterbar">
      <div className="chips scroll">
        <select
          className="chip select"
          value={value.period}
          onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKey })}
          aria-label="期間"
        >
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <option key={k} value={k}>
              {PERIOD_LABELS[k]}
            </option>
          ))}
        </select>
        {tags.map((t) => (
          <button key={t} className={`chip ${value.tags.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>
            #{t}
          </button>
        ))}
      </div>
      {value.period === 'custom' && (
        <div className="range">
          <input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
          <span>〜</span>
          <input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
        </div>
      )}
    </div>
  );
}

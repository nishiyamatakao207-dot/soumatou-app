import { useState } from 'react';

const DEFAULT_TAGS = ['旅行', '子ども', 'イベント', '家族', '食事'];

/** 付いているタグ＋候補タグ＋新しいタグの入力 */
export function TagPicker({ value, onChange, known }: { value: string[]; onChange: (v: string[]) => void; known: string[] }) {
  const [draft, setDraft] = useState('');
  const suggestions = [...new Set([...known, ...DEFAULT_TAGS])].filter((t) => !value.includes(t));

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };

  return (
    <div className="tagpicker">
      <div className="chips">
        {value.map((t) => (
          <button type="button" key={t} className="chip on" onClick={() => onChange(value.filter((x) => x !== t))}>
            #{t} <span aria-label="外す">×</span>
          </button>
        ))}
        {value.length === 0 && <span className="muted small">タグなし</span>}
      </div>
      <form
        className="tag-input"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="新しいタグ" enterKeyHint="done" />
        <button type="submit" className="btn small" disabled={!draft.trim()}>
          追加
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((t) => (
            <button type="button" key={t} className="chip" onClick={() => add(t)}>
              ＋{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

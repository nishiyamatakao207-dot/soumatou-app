import { memo } from 'react';
import { Thumb } from '../Thumb';
import type { Entry } from '../../lib/entries';
import { formatDate } from '../../lib/format';
import { navigate } from '../../router';

/** 一覧の1枚のカード（数千枚あっても描き直しが少ないよう memo） */
export const EntryCard = memo(function EntryCard({ e }: { e: Entry }) {
  const text = e.media.find((m) => m.caption)?.caption || e.memory.text;
  const open = () => navigate(`/edit/${encodeURIComponent(e.memory.id)}`);
  return (
    <div
      className={`card ${e.needsFeeling ? 'no-feeling' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && open()}
    >
      <div className="card-media">
        {e.media[0] ? <Thumb item={e.media[0]} lazy /> : <div className="thumb text-only">✎</div>}
        {e.media.length > 1 && <span className="count">{e.media.length}</span>}
      </div>
      <div className="card-body">
        <div className="card-date">{formatDate(e.date)}</div>
        {text && <p className="card-text">{text}</p>}
        {e.memory.tags.length > 0 && <div className="card-tags">{e.memory.tags.map((t) => `#${t}`).join(' ')}</div>}
        {e.split && <div className="card-split">ほかの日の写真も同じ記録にあります</div>}
        {e.needsFeeling && (
          <button
            className="btn small add-feel"
            onClick={(ev) => {
              ev.stopPropagation();
              navigate(`/feel/${encodeURIComponent(e.memory.id)}`);
            }}
          >
            ✎ 気持ちを足す
          </button>
        )}
      </div>
    </div>
  );
});

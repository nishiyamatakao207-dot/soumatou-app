import { useEffect, useState } from 'react';
import { getMedia, thumbKey } from '../data/repository';
import type { MediaDraft } from '../data/types';
import { useStoredUrl } from '../lib/useStoredUrl';

/** 一覧・編集で使う小さい画像。item を渡すか、id から読み込む */
export function Thumb({ item, id, className }: { item?: MediaDraft; id?: string; className?: string }) {
  const [loaded, setLoaded] = useState<MediaDraft | undefined>(item);
  useEffect(() => {
    if (item) setLoaded(item);
    else if (id) getMedia(id).then(setLoaded);
  }, [item, id]);

  const m = loaded;
  // 未保存なら取り込んだ Blob、保存済みならデータベースから
  const draft = m?.thumbFile ?? (m?.kind === 'photo' ? m?.file : undefined);
  const fileId = !m || draft || m.missing ? undefined : m.hasThumb ? thumbKey(m.id) : m.kind === 'photo' ? m.id : undefined;
  const { url, missing: thumbMissing } = useStoredUrl(fileId, draft);
  const missing = m?.missing || (m?.kind === 'photo' && thumbMissing);

  return (
    <div className={`thumb ${missing ? 'is-missing' : ''} ${className ?? ''}`}>
      {missing ? (
        <span className="thumb-missing">画像が見つかりません</span>
      ) : url ? (
        <img src={url} alt="" />
      ) : (
        <span className="thumb-ph">{m?.kind === 'video' ? '🎬' : ''}</span>
      )}
      {m?.kind === 'video' && !missing && <span className="thumb-badge">▶</span>}
    </div>
  );
}



import { useEffect, useRef, useState } from 'react';
import { getMedia, thumbKey } from '../data/repository';
import type { MediaDraft } from '../data/types';
import { useStoredUrl } from '../lib/useStoredUrl';

/** 画面に近づいたら true になる（一度なったら戻らない）。数千枚あっても、見える分だけ読み込むため */
function useNearScreen(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!enabled);
  useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near]);
  return { ref, near };
}

/**
 * 一覧・編集で使う小さい画像（取り込むときに作った、一辺480ピクセルの小さい画像を使う）。
 * item を渡すか、id から読み込む。lazy：画面に近づいてから読み込む
 */
export function Thumb({ item, id, className, lazy }: { item?: MediaDraft; id?: string; className?: string; lazy?: boolean }) {
  const { ref, near } = useNearScreen(!!lazy);
  const [loaded, setLoaded] = useState<MediaDraft | undefined>(item);
  useEffect(() => {
    if (item) setLoaded(item);
    else if (id && near) getMedia(id).then(setLoaded);
  }, [item, id, near]);

  const m = loaded;
  // 未保存なら取り込んだ Blob、保存済みならデータベースから
  const draft = m?.thumbFile ?? (m?.kind === 'photo' ? m?.file : undefined);
  const fileId = !near || !m || draft || m.missing ? undefined : m.hasThumb ? thumbKey(m.id) : m.kind === 'photo' ? m.id : undefined;
  const { url, missing: thumbMissing } = useStoredUrl(fileId, near ? draft : undefined);
  const missing = m?.missing || (m?.kind === 'photo' && thumbMissing);

  return (
    <div ref={ref} className={`thumb ${missing ? 'is-missing' : ''} ${className ?? ''}`}>
      {missing ? (
        <span className="thumb-missing">画像が見つかりません</span>
      ) : url ? (
        <img src={url} alt="" decoding="async" />
      ) : (
        <span className="thumb-ph">{m?.kind === 'video' ? '🎬' : ''}</span>
      )}
      {m?.kind === 'video' && !missing && <span className="thumb-badge">▶</span>}
    </div>
  );
}

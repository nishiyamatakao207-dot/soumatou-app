import { useEffect, useState } from 'react';
import { getMedia } from '../data/repository';
import type { MediaItem } from '../data/types';
import { useObjectUrl } from '../lib/useObjectUrl';

/** メディアの小さい画像。item を渡すか、id から読み込む */
export function Thumb({ item, id, className }: { item?: MediaItem; id?: string; className?: string }) {
  const [loaded, setLoaded] = useState<MediaItem | undefined>(item);
  useEffect(() => {
    if (item) setLoaded(item);
    else if (id) getMedia(id).then(setLoaded);
  }, [item, id]);
  const src = useObjectUrl(loaded ? (loaded.thumb ?? (loaded.kind === 'photo' ? loaded.blob : undefined)) : undefined);
  return (
    <div className={`thumb ${className ?? ''}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="thumb-ph">{loaded?.kind === 'video' ? '🎬' : ''}</span>}
      {loaded?.kind === 'video' && <span className="thumb-badge">▶</span>}
    </div>
  );
}

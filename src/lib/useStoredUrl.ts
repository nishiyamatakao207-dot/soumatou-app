import { useEffect, useState } from 'react';
import { loadFile } from '../data/repository';

/**
 * 保存したファイルを画面に出すためのURL。
 * 表示のたびにデータベースから中身を読み、URL.createObjectURL で作り直す。
 * 画面から消えるときに revokeObjectURL で片付ける。
 * 取り込んだ直後（未保存）のときは draft の Blob をそのまま使う。
 */
export function useStoredUrl(fileId: string | undefined, draft?: Blob) {
  const [state, setState] = useState<{ url?: string; missing: boolean; loading: boolean }>({ missing: false, loading: true });

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    const show = (b: Blob | null) => {
      if (cancelled) return;
      if (!b) return setState({ missing: true, loading: false });
      url = URL.createObjectURL(b);
      setState({ url, missing: false, loading: false });
    };
    setState({ missing: false, loading: true });
    if (draft) show(draft);
    else if (fileId) loadFile(fileId).then(show, () => show(null));
    else setState({ missing: false, loading: false });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, draft]);

  return state;
}

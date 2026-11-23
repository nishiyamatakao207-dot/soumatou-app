import { useCallback, useEffect, useState } from 'react';
import type { BgmChoice } from './music';

/* アプリの設定（この端末だけに保存） */

export interface Settings {
  /** 再生中に写真の日付を表示する */
  showDate: boolean;
  /** BGM */
  bgm: BgmChoice;
  /** 自分の曲のファイル名（表示用） */
  customBgmName: string;
}

const DEFAULTS: Settings = { showDate: true, bgm: 'gentle', customBgmName: '' };
const KEY = 'meguru.settings';

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function useSetting<K extends keyof Settings>(key: K): [Settings[K], (v: Settings[K]) => void] {
  const [value, setValue] = useState<Settings[K]>(() => read()[key]);
  useEffect(() => {
    const on = () => setValue(read()[key]);
    window.addEventListener('meguru-settings', on);
    return () => window.removeEventListener('meguru-settings', on);
  }, [key]);
  const set = useCallback(
    (v: Settings[K]) => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: v }));
      } catch {
        /* 保存できなくても今回の画面では反映 */
      }
      setValue(v);
      window.dispatchEvent(new Event('meguru-settings'));
    },
    [key],
  );
  return [value, set];
}

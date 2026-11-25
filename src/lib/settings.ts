import { useCallback, useEffect, useState } from 'react';
import type { BgmChoice } from './music';
import type { PhotoShape } from './shape';
import type { ExportMode, ExportQuality } from './exporter';
import type { VoiceMethod } from './voiceMethod';

/* アプリの設定（この端末だけに保存） */

export interface Settings {
  /** 再生中に写真の日付を表示する */
  showDate: boolean;
  /** BGM */
  bgm: BgmChoice;
  /** 自分の曲のファイル名（表示用） */
  customBgmName: string;
  /** 前回の記録で使ったタグ（新しい記録で最初から選んでおく） */
  lastTags: string[];
  /** アプリを開いたときに「今日のひとめぐり」を流す */
  dailyDigest: boolean;
  /** 「◯年前の今日」の記録があればお知らせする */
  onThisDay: boolean;
  /** 再生するときの写真の形 */
  photoShape: PhotoShape;
  /** 動画の書き出し：画質 */
  exportQuality: ExportQuality;
  /** 動画の書き出し：方法（きれいに書き出す／再生しながら録画） */
  exportMode: ExportMode;
  /** 動画の書き出し：動画素材の元の音（子どもの声など）を入れる */
  exportVideoSound: boolean;
  /** 「声で入力」のやり方（auto：アプリの音声認識、だめならキーボードの音声入力） */
  voiceMethod: VoiceMethod;
  /** 写真1枚の表示時間（秒） */
  photoSec: number;
  /** 字幕が長い写真は、自動で表示時間を延ばす */
  autoLongCaption: boolean;
}

const DEFAULTS: Settings = { showDate: true, bgm: 'gentle', customBgmName: '', lastTags: [], dailyDigest: true, onThisDay: true, photoShape: 'circle', exportQuality: 'standard', exportMode: 'encode', exportVideoSound: true, voiceMethod: 'auto', photoSec: 7, autoLongCaption: true };

/** 画面の外（起動時の判定など）から設定を読む */
export const readSetting = <K extends keyof Settings>(key: K): Settings[K] => read()[key];
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

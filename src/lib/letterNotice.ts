import { isReady, listLetters } from '../data/repository';
import type { Memory } from '../data/types';

/* 開けられるようになった手紙のお知らせ（1通につき1回、アプリを開いたときに大きく出す） */

const KEY = 'meguru.letter.announced';

function announced(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function markAnnounced(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set([...announced(), ...ids])]));
  } catch {
    /* 保存できなくても動く */
  }
}

/** 開けられる日が来ていて、まだ大きなお知らせを出していない手紙 */
export async function readyLettersToAnnounce(): Promise<Memory[]> {
  const done = new Set(announced());
  return (await listLetters()).filter((m) => isReady(m) && !done.has(m.id));
}

import { listDatedItems, type DatedItem } from '../data/repository';

/* 今日のひとめぐり：過去の記録からランダムに写真を選んで、約1分の走馬灯にする */

/** 写真1枚あたり約7秒なので、8枚でおよそ1分 */
export const DIGEST_COUNT = 8;
/** これより写真が少ないときは流さない */
export const DIGEST_MIN = 3;
/** アプリに戻ってきたとき、これ以上あいていたらもう一度流す */
export const DIGEST_AGAIN_MS = 60 * 60 * 1000;

function shuffle<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

/**
 * 写真を選ぶ。同じ記録ばかりにならないよう、記録ごとに順番に1枚ずつ取っていき、
 * 選んだ写真は日付順に並べる（思い出が時間の流れにそって流れるように）。
 * 写真が少なすぎるときは null。
 */
export async function pickDigest(): Promise<DatedItem[] | null> {
  const photos = (await listDatedItems()).filter((it) => it.media?.kind === 'photo' && !it.media.missing);
  if (photos.length < DIGEST_MIN) return null;
  const byMemory = new Map<string, DatedItem[]>();
  for (const p of shuffle(photos)) {
    const list = byMemory.get(p.memory.id) ?? [];
    list.push(p);
    byMemory.set(p.memory.id, list);
  }
  const groups = shuffle([...byMemory.values()]);
  const picked: DatedItem[] = [];
  while (picked.length < DIGEST_COUNT && groups.some((g) => g.length)) {
    for (const g of groups) {
      const p = g.shift();
      if (p) picked.push(p);
      if (picked.length >= DIGEST_COUNT) break;
    }
  }
  return picked.sort((a, b) => a.date - b.date);
}

/** 写真が足りているか（設定画面の「今すぐ見る」用） */
export async function digestAvailable(): Promise<boolean> {
  const items = await listDatedItems();
  return items.filter((it) => it.media?.kind === 'photo' && !it.media.missing).length >= DIGEST_MIN;
}

import { db } from '../data/db';
import { thumbKey } from '../data/repository';

/* この端末の中で、思い出がどれくらいの容量を使っているか。 */

export interface StorageInfo {
  /** アプリ全体で使っている容量（バイト）。わからないときは null */
  usage: number | null;
  /** このアプリが使える上限の目安（iPhone では本体の容量の約60%）。わからないときは null */
  quota: number | null;
  photo: { count: number; bytes: number };
  video: { count: number; bytes: number };
}

/** ブラウザが教えてくれる、使っている容量と上限の目安 */
export async function estimate(): Promise<{ usage: number | null; quota: number | null }> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage ?? null, quota: e?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/**
 * 写真・動画ごとの容量。大きさを覚えていない古い記録は、1つずつ測って覚えておく（次からは速い）。
 * onProgress：測っている途中の数（画面に「計算中」を出すため）
 */
export async function storageInfo(onProgress?: (done: number, total: number) => void): Promise<StorageInfo> {
  const rows = await db.media.toArray();
  const unknown = rows.filter((r) => r.bytes == null);
  let done = 0;
  for (const r of unknown) {
    let bytes = 0;
    for (const id of [r.id, thumbKey(r.id)]) {
      const f = await db.files.get(id);
      bytes += f?.data.byteLength ?? 0;
    }
    r.bytes = bytes;
    await db.media.update(r.id, { bytes });
    onProgress?.(++done, unknown.length);
  }
  const sum = (kind: 'photo' | 'video') => {
    const list = rows.filter((r) => r.kind === kind);
    return { count: list.length, bytes: list.reduce((n, r) => n + (r.bytes ?? 0), 0) };
  };
  return { ...(await estimate()), photo: sum('photo'), video: sum('video') };
}

/** 残りがこれより少なくなったら、記録するときに知らせる */
const LOW_BYTES = 1024 ** 3; // 1GB
const LOW_RATIO = 0.9;

/** 残りが少ないか。少なければ残りの目安（バイト）を返す */
export async function lowSpace(): Promise<number | null> {
  const { usage, quota } = await estimate();
  if (usage == null || !quota) return null;
  const left = quota - usage;
  return left < LOW_BYTES || usage / quota > LOW_RATIO ? Math.max(0, left) : null;
}

/** 容量を読みやすく（例：1.2GB、350MB） */
export function formatBytes(n: number): string {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)}GB`;
  if (n >= MB) return `${Math.round(n / MB)}MB`;
  return `${Math.max(0, Math.round(n / 1024))}KB`;
}

import { db, type LegacyMediaRow } from './db';
import type { MediaDraft, MediaItem, Memory, MemoryFilter, StoredFile } from './types';

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const thumbKey = (id: string) => `${id}:thumb`;

export async function listMemories(filter?: MemoryFilter): Promise<Memory[]> {
  let all = await db.memories.orderBy('date').toArray();
  if (filter) {
    all = all.filter((m) => {
      if (filter.from != null && m.date < filter.from) return false;
      if (filter.to != null && m.date > filter.to) return false;
      if (filter.tags.length && !filter.tags.some((t) => m.tags.includes(t))) return false;
      return true;
    });
  }
  return all;
}

export const getMemory = (id: string) => db.memories.get(id);

/** media の行から、画面に渡す情報だけを取り出す */
function clean(row: LegacyMediaRow): MediaItem {
  const { blob: _b, thumb: _t, missing: _m, ...rest } = row;
  return rest;
}

/** ファイルの中身があるかどうかを付けて返す */
async function withMissing(rows: LegacyMediaRow[]): Promise<MediaItem[]> {
  const ids = rows.map((r) => r.id);
  const present = new Set(await db.files.where(':id').anyOf(ids).primaryKeys());
  return rows.map((r) => ({ ...clean(r), missing: !present.has(r.id) }));
}

export async function getMedia(id: string): Promise<MediaItem | undefined> {
  const row = await db.media.get(id);
  return row ? (await withMissing([row]))[0] : undefined;
}

export async function getMediaFor(memory: Memory): Promise<MediaItem[]> {
  const rows = (await db.media.bulkGet(memory.mediaIds)).filter((x): x is LegacyMediaRow => !!x);
  return withMissing(rows);
}

/** 保存したファイルを Blob に戻す（表示のたびに呼ぶ） */
export async function loadFile(id: string): Promise<Blob | null> {
  const f = await db.files.get(id);
  return f && f.data.byteLength ? new Blob([f.data], { type: f.type }) : null;
}

async function toStored(id: string, blob: Blob): Promise<StoredFile> {
  return { id, data: await blob.arrayBuffer(), type: blob.type || 'application/octet-stream' };
}

/** 記録を保存（新規・更新どちらも）。外されたメディアのファイルも片付ける */
export async function saveMemory(memory: Memory, media: MediaDraft[]): Promise<void> {
  // ファイルの中身はトランザクションの外で先にバイト列にしておく
  const files: StoredFile[] = [];
  for (const d of media) {
    if (d.file) files.push(await toStored(d.id, d.file));
    if (d.thumbFile) files.push(await toStored(thumbKey(d.id), d.thumbFile));
  }
  const rows: MediaItem[] = media.map(({ file: _f, thumbFile, missing: _m, ...m }) => ({
    ...m,
    memoryId: memory.id,
    hasThumb: thumbFile ? true : m.hasThumb,
  }));

  await db.transaction('rw', [db.memories, db.media, db.files], async () => {
    const old = await db.media.where('memoryId').equals(memory.id).primaryKeys();
    const keep = new Set(media.map((m) => m.id));
    const removed = old.filter((id) => !keep.has(id));
    await db.media.bulkDelete(removed);
    await db.files.bulkDelete(removed.flatMap((id) => [id, thumbKey(id)]));
    await db.files.bulkPut(files);
    await db.media.bulkPut(rows);
    await db.memories.put({ ...memory, mediaIds: media.map((m) => m.id), updatedAt: Date.now() });
  });

  // 書き込めたか確認（容量不足などで欠けていたら知らせる）
  const saved = await db.files.where(':id').anyOf(files.map((f) => f.id)).primaryKeys();
  if (saved.length !== files.length) throw new Error('写真・動画の保存に失敗しました');
}

export async function deleteMemory(id: string): Promise<void> {
  await db.transaction('rw', [db.memories, db.media, db.files], async () => {
    const ids = await db.media.where('memoryId').equals(id).primaryKeys();
    await db.files.bulkDelete(ids.flatMap((m) => [m, thumbKey(m)]));
    await db.media.bulkDelete(ids);
    await db.memories.delete(id);
  });
}

/**
 * 以前の版（Blob のまま保存）のデータを、バイト列の保存に移す。
 * すでに読めなくなっている Blob は「見つからない」扱いになる。
 */
export async function migrateLegacyMedia(): Promise<void> {
  const legacy = await db.media.filter((r) => r.blob !== undefined || r.thumb !== undefined).toArray();
  for (const row of legacy) {
    const files: StoredFile[] = [];
    try {
      if (row.blob) files.push(await toStored(row.id, row.blob));
    } catch {
      /* 中身が読めない（壊れている） */
    }
    try {
      if (row.thumb) files.push(await toStored(thumbKey(row.id), row.thumb));
    } catch {
      /* サムネイルが読めない */
    }
    const hasThumb = files.some((f) => f.id === thumbKey(row.id));
    await db.transaction('rw', [db.media, db.files], async () => {
      await db.files.bulkPut(files);
      await db.media.put({ ...clean(row), hasThumb });
    });
  }
}

/** これまでに使われたタグ（多い順） */
export async function listTags(): Promise<string[]> {
  const count = new Map<string, number>();
  await db.memories.each((m) => m.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** ブラウザに「勝手に消さないで」とお願いする（対応ブラウザのみ） */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* 非対応でも動作には影響なし */
  }
}

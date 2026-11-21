import { db } from './db';
import type { MediaItem, Memory, MemoryFilter } from './types';

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

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

export const getMedia = (id: string) => db.media.get(id);

export async function getMediaFor(memory: Memory): Promise<MediaItem[]> {
  const items = await db.media.bulkGet(memory.mediaIds);
  return items.filter((x): x is MediaItem => !!x);
}

/** 記録を保存（新規・更新どちらも）。消されたメディアも片付ける */
export async function saveMemory(memory: Memory, media: MediaItem[]): Promise<void> {
  await db.transaction('rw', db.memories, db.media, async () => {
    const old = await db.media.where('memoryId').equals(memory.id).primaryKeys();
    const keep = new Set(media.map((m) => m.id));
    await db.media.bulkDelete(old.filter((id) => !keep.has(id)));
    await db.media.bulkPut(media.map((m) => ({ ...m, memoryId: memory.id })));
    await db.memories.put({ ...memory, mediaIds: media.map((m) => m.id), updatedAt: Date.now() });
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await db.transaction('rw', db.memories, db.media, async () => {
    await db.media.where('memoryId').equals(id).delete();
    await db.memories.delete(id);
  });
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

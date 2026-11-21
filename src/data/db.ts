import Dexie, { type Table } from 'dexie';
import type { MediaItem, Memory } from './types';

/**
 * 端末内データベース（ブラウザの IndexedDB）。
 * アプリの他の部分はこのファイルを直接使わず、repository.ts 経由で使う。
 * 将来ネイティブ化・クラウド同期するときは repository.ts の中身だけ差し替える。
 */
class SoumatouDB extends Dexie {
  memories!: Table<Memory, string>;
  media!: Table<MediaItem, string>;

  constructor() {
    super('soumatou');
    this.version(1).stores({
      memories: 'id, date, *tags',
      media: 'id, memoryId',
    });
  }
}

export const db = new SoumatouDB();

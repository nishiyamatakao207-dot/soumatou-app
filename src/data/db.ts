import Dexie, { type Table } from 'dexie';
import type { MediaItem, Memory, StoredFile } from './types';

/** 以前の版で media に直接入れていた Blob（読み込み時に files へ移す） */
export type LegacyMediaRow = MediaItem & { blob?: Blob | null; thumb?: Blob | null };

/**
 * 端末内データベース（ブラウザの IndexedDB）。
 * アプリの他の部分はこのファイルを直接使わず、repository.ts 経由で使う。
 */
class SoumatouDB extends Dexie {
  memories!: Table<Memory, string>;
  media!: Table<LegacyMediaRow, string>;
  files!: Table<StoredFile, string>;

  constructor() {
    super('soumatou');
    this.version(1).stores({
      memories: 'id, date, *tags',
      media: 'id, memoryId',
    });
    // v2: ファイルの中身を files テーブルに ArrayBuffer で保存
    this.version(2).stores({
      memories: 'id, date, *tags',
      media: 'id, memoryId',
      files: 'id',
    });
  }
}

export const db = new SoumatouDB();

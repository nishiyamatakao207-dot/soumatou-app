/** 1件の「思い出」の記録 */
export interface Memory {
  id: string;
  /** 思い出の日時（撮影日を優先、なければ作成時）ミリ秒 */
  date: number;
  /** 思い出全体のひとこと */
  text: string;
  tags: string[];
  /** 表示順に並んだメディアID */
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type MediaKind = 'photo' | 'video';

/** 写真・動画の日付をどこから取ったか */
export type DateSource =
  | 'exif' // 写真のデータに入っていた撮影日
  | 'video' // 動画のデータに入っていた撮影日
  | 'file' // ファイルの日付（参考）
  | 'memory' // 記録の日付
  | 'manual'; // 手で入力

/**
 * 写真・動画の情報（ファイルの中身は files テーブルに別保存）。
 * 中身を分けておくと、一覧や再生で必要な分だけ読み込める。
 */
export interface MediaItem {
  id: string;
  memoryId: string;
  kind: MediaKind;
  /** この写真・動画の日時（並び順・表示に使う） */
  takenAt?: number;
  /** takenAt をどこから取ったか */
  dateSource?: DateSource;
  /** この写真・動画へのコメント（その時の思い） */
  caption?: string;
  /** 一覧用の小さい画像があるか */
  hasThumb?: boolean;
  /** 読み込み時に判明：ファイルの中身が見つからない */
  missing?: boolean;
}

/** 取り込んだ直後で、まだ保存していない写真・動画 */
export interface MediaDraft extends MediaItem {
  file?: Blob;
  thumbFile?: Blob;
}

/**
 * ファイルの中身。iPhone の Safari では Blob のまま保存すると
 * アプリを閉じた後に読めなくなることがあるため、生のバイト列で保存する。
 */
export interface StoredFile {
  id: string;
  data: ArrayBuffer;
  type: string;
}

/** 走馬灯の絞り込み条件 */
export interface MemoryFilter {
  /** いずれかのタグを含む（空なら全部） */
  tags: string[];
  from?: number;
  to?: number;
  /** この月日（'MM-DD'）だけ。年はどれでもよい（◯年前の今日） */
  monthDays?: string[];
}

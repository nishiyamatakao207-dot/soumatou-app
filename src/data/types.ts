/** 1件の「思い出」の記録 */
export interface Memory {
  id: string;
  /** 思い出の日時（撮影日を優先、なければ作成時）ミリ秒 */
  date: number;
  /** 気持ち（声の文字起こし or 手入力） */
  text: string;
  tags: string[];
  /** 表示順に並んだメディアID */
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type MediaKind = 'photo' | 'video';

/** 写真・動画の実体（大きいので Memory とは別に保存） */
export interface MediaItem {
  id: string;
  memoryId: string;
  kind: MediaKind;
  blob: Blob;
  /** 一覧用の小さい画像 */
  thumb?: Blob;
  /** 撮影日時（わかった場合） */
  takenAt?: number;
  /** この写真・動画へのコメント（その時の思い） */
  caption?: string;
}

/** 走馬灯の絞り込み条件 */
export interface MemoryFilter {
  /** いずれかのタグを含む（空なら全部） */
  tags: string[];
  from?: number;
  to?: number;
}

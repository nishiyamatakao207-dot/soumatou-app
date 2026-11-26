import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { db, type LegacyMediaRow } from '../data/db';
import type { MediaItem, Memory, StoredFile } from '../data/types';

/* バックアップ（.meguru ファイル）を作る・戻す。
 *
 * ファイルの中身は ZIP 形式：
 *   manifest.json … アプリ名・形式・作った日時・件数・（鍵をかけたとき）鍵の情報
 *   memories.json … 記録（言葉・日付・タグ・未来への手紙など）
 *   media.json    … 写真・動画の情報（コメント・日付など）
 *   files.json    … ファイルの一覧（種類）
 *   files/…       … 写真・動画・サムネイル・自分の曲 の中身
 *
 * パスワードを決めたときは、manifest 以外のすべてを AES-256（暗号化の標準的な方式）で暗号化する。
 * パスワードから鍵を作る方法は PBKDF2（何十万回もくり返して、総当たりで当てにくくする）。 */

const FORMAT = 1;
const ITERATIONS = 310_000;
const CHECK_TEXT = 'meguru-backup-ok';
const LAST_BACKUP_KEY = 'meguru.backup.last';

export interface BackupProgress {
  ratio: number;
  label: string;
}

interface Manifest {
  app: 'meguru';
  format: number;
  createdAt: number;
  counts: { memories: number; media: number; files: number };
  encryption?: { salt: string; iterations: number; check: string };
}

// ---------------------------------------------------------------- 暗号化

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 暗号化の関数に渡すための型合わせ */
const bs = (u: Uint8Array) => u as unknown as BufferSource;

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', bs(strToU8(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bs(salt), iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** 暗号化：先頭12バイトがランダムな番号（IV）、そのあとが暗号文 */
async function encrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(data)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(data.subarray(0, 12)) }, key, bs(data.subarray(12))));
}

// ---------------------------------------------------------------- 作る

/** 写真・動画のファイル名（ZIP の中）。種類（写真か動画か）も名前に入れておく */
const entryName = (id: string, type: string) => `files/${encodeURIComponent(id)}~${encodeURIComponent(type)}`;
function parseEntryName(name: string): { id: string; type: string } {
  const [id, type = ''] = name.slice('files/'.length).split('~');
  return { id: decodeURIComponent(id), type: decodeURIComponent(type) };
}
/** 作った曲の一時保存はバックアップに入れない（また作れるため） */
const isCache = (id: string) => id.startsWith('bgm:cache:');

/** バックアップに入る量（画面に出す目安） */
export async function backupSummary() {
  const memories = await db.memories.count();
  const media = await db.media.count();
  let bytes = 0;
  let files = 0;
  await db.files.each((f) => {
    if (isCache(f.id)) return;
    bytes += f.data.byteLength;
    files++;
  });
  return { memories, media, files, bytes };
}

export async function createBackup(password: string | null, onProgress: (p: BackupProgress) => void): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let zipError: unknown;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else chunks.push(chunk);
  });
  const put = (name: string, data: Uint8Array) => {
    const f = new ZipPassThrough(name); // 写真・動画はもう圧縮されているので、そのまま入れる
    zip.add(f);
    f.push(data, true);
    if (zipError) throw zipError;
  };

  onProgress({ ratio: 0, label: '準備中…' });
  const memories = await db.memories.toArray();
  const mediaRows = (await db.media.toArray()).map(({ blob: _b, thumb: _t, ...rest }: LegacyMediaRow) => rest as MediaItem);
  const fileIds = ((await db.files.toCollection().primaryKeys()) as string[]).filter((id) => !isCache(id));

  let key: CryptoKey | null = null;
  const manifest: Manifest = {
    app: 'meguru',
    format: FORMAT,
    createdAt: Date.now(),
    counts: { memories: memories.length, media: mediaRows.length, files: fileIds.length },
  };
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(password, salt, ITERATIONS);
    manifest.encryption = { salt: b64(salt), iterations: ITERATIONS, check: b64(await encrypt(key, strToU8(CHECK_TEXT))) };
  }
  const seal = async (data: Uint8Array) => (key ? encrypt(key, data) : data);
  const json = (v: unknown) => strToU8(JSON.stringify(v));

  put('manifest.json', json(manifest));
  put('memories.json', await seal(json(memories)));
  put('media.json', await seal(json(mediaRows)));
  const index: { id: string; type: string }[] = [];

  for (let i = 0; i < fileIds.length; i++) {
    const f = await db.files.get(fileIds[i]);
    if (!f) continue;
    index.push({ id: f.id, type: f.type });
    put(entryName(f.id, f.type), await seal(new Uint8Array(f.data)));
    onProgress({ ratio: (i + 1) / fileIds.length, label: `写真・動画を入れています（${i + 1}/${fileIds.length}）` });
  }
  put('files.json', await seal(json(index)));
  zip.end();
  if (zipError) throw zipError;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

export function backupFileName() {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `meguru-backup-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}.meguru`;
}

export function markBackedUp() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  } catch {
    /* 保存できなくても動く */
  }
}

const SNOOZE_KEY = 'meguru.backup.snooze';
/** 前回から1か月たったら */
const REMIND_AFTER = 30 * 864e5;
/** 前回から新しい記録がこれだけ増えたら */
export const REMIND_NEW = 30;
/** 「あとで」を押したら、しばらく（2週間）出さない */
const SNOOZE_DAYS = 14;

export type BackupReason = 'never' | 'month' | 'many';

/**
 * バックアップをおすすめするか、その理由。
 * - まだ作っていない（記録が3件以上あるとき）
 * - 前回から1か月たった
 * - 前回から新しい記録が30件以上増えた
 * 「あとで」から2週間は出さない
 */
export function backupReminderReason(memories: number, newSinceLast: number): BackupReason | null {
  if (memories < 3) return null;
  try {
    if (Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now()) return null;
  } catch {
    /* 読めなくても判定は続ける */
  }
  const last = lastBackupAt();
  if (!last) return 'never';
  if (newSinceLast >= REMIND_NEW) return 'many';
  if (Date.now() - last > REMIND_AFTER) return 'month';
  return null;
}

export function snoozeBackupReminder() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
  } catch {
    /* 保存できなくても動く */
  }
}

export function lastBackupAt(): number | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 戻す

export class WrongPasswordError extends Error {
  constructor() {
    super('パスワードが違います');
    this.name = 'WrongPasswordError';
  }
}
export class NeedPasswordError extends Error {
  constructor() {
    super('このバックアップにはパスワードの鍵がかかっています');
    this.name = 'NeedPasswordError';
  }
}

export interface RestoreResult {
  added: number;
  skipped: number;
  files: number;
}

/** ZIP の中身を、届いた順に1つずつ取り出す（大きなファイルでも全部を一度に読まない） */
async function readEntries(file: Blob, onEntry: (name: string, data: Uint8Array) => Promise<void>, onRead: (ratio: number) => void) {
  let queue = Promise.resolve();
  let failure: unknown;
  const uz = new Unzip((f) => {
    const parts: Uint8Array[] = [];
    f.ondata = (err, dat, final) => {
      if (err) {
        failure = err;
        return;
      }
      parts.push(dat);
      if (final) {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const all = new Uint8Array(size);
        let o = 0;
        for (const p of parts) {
          all.set(p, o);
          o += p.length;
        }
        queue = queue.then(() => onEntry(f.name, all)).catch((e) => {
          failure = e;
        });
      }
    };
    f.start();
  });
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);

  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (failure) throw failure;
    if (done) {
      uz.push(new Uint8Array(0), true);
      break;
    }
    read += value.length;
    uz.push(value);
    onRead(read / file.size);
    // 書き込みが追いつくのを待つ（メモリを使いすぎないように）
    await queue;
  }
  await queue;
  if (failure) throw failure;
}

/** バックアップか確かめて、鍵がかかっているかを返す */
export async function inspectBackup(file: Blob): Promise<Manifest> {
  // manifest.json は先頭にあるので、最初の少しだけ読めばわかる
  let manifest: Manifest | null = null;
  const head = file.slice(0, Math.min(file.size, 64 * 1024));
  await new Promise<void>((resolve) => {
    const uz = new Unzip((f) => {
      if (f.name !== 'manifest.json') return;
      const parts: Uint8Array[] = [];
      f.ondata = (err, dat, final) => {
        if (err) return resolve();
        parts.push(dat);
        if (final) {
          try {
            manifest = JSON.parse(strFromU8(parts.length === 1 ? parts[0] : new Uint8Array(parts.flatMap((p) => [...p]))));
          } catch {
            /* 読めない */
          }
          resolve();
        }
      };
      f.start();
    });
    uz.register(UnzipPassThrough);
    uz.register(UnzipInflate);
    head.arrayBuffer().then((b) => {
      try {
        uz.push(new Uint8Array(b), true);
      } catch {
        /* 途中で切れていても manifest は読めている */
      }
      resolve();
    });
  });
  const m = manifest as Manifest | null;
  if (!m || m.app !== 'meguru') throw new Error('めぐるのバックアップファイルではありません');
  if (m.format > FORMAT) throw new Error('新しい版のアプリで作られたバックアップです。アプリを新しくしてからお試しください');
  return m;
}

/**
 * バックアップから戻す。すでにある記録（同じもの）はそのまま残し、ないものだけを足す。
 */
export async function restoreBackup(file: Blob, password: string | null, onProgress: (p: BackupProgress) => void): Promise<RestoreResult> {
  const manifest = await inspectBackup(file);
  let key: CryptoKey | null = null;
  if (manifest.encryption) {
    if (!password) throw new NeedPasswordError();
    key = await deriveKey(password, unb64(manifest.encryption.salt), manifest.encryption.iterations);
    try {
      const ok = strFromU8(await decrypt(key, unb64(manifest.encryption.check)));
      if (ok !== CHECK_TEXT) throw new WrongPasswordError();
    } catch {
      throw new WrongPasswordError();
    }
  }
  const open = async (data: Uint8Array) => (key ? decrypt(key, data) : data);

  const existing = new Set((await db.memories.toCollection().primaryKeys()) as string[]);
  let memories: Memory[] = [];
  let newMemoryIds = new Set<string>();
  /** 足す記録に入っている写真・動画のファイル */
  const wantedFiles = new Set<string>();
  const pendingFiles: StoredFile[] = [];
  let mediaRows: MediaItem[] = [];
  let filesWritten = 0;

  const flushFiles = async () => {
    if (!pendingFiles.length) return;
    await db.files.bulkPut(pendingFiles.splice(0));
  };

  await readEntries(
    file,
    async (name, raw) => {
      if (name === 'manifest.json') return;
      if (name === 'memories.json') {
        memories = JSON.parse(strFromU8(await open(raw)));
        newMemoryIds = new Set(memories.filter((m) => !existing.has(m.id)).map((m) => m.id));
        return;
      }
      if (name === 'media.json') {
        mediaRows = JSON.parse(strFromU8(await open(raw)));
        for (const m of mediaRows) {
          if (!newMemoryIds.has(m.memoryId)) continue;
          wantedFiles.add(m.id);
          wantedFiles.add(`${m.id}:thumb`);
        }
        // 自分の曲は、まだ端末にないときだけ戻す
        if (!(await db.files.get('bgm:custom'))) wantedFiles.add('bgm:custom');
        return;
      }
      if (name === 'files.json') return; // 一覧（中身の確認用）
      if (name.startsWith('files/')) {
        const { id, type } = parseEntryName(name);
        if (!wantedFiles.has(id)) return;
        const data = await open(raw);
        pendingFiles.push({ id, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, type });
        filesWritten++;
        if (pendingFiles.length >= 4) await flushFiles();
      }
    },
    (ratio) => onProgress({ ratio: ratio * 0.95, label: `読み込んでいます…` }),
  );
  await flushFiles();

  // 記録と写真の情報を足す
  const add = memories.filter((m) => newMemoryIds.has(m.id));
  await db.transaction('rw', db.memories, db.media, async () => {
    await db.media.bulkPut(mediaRows.filter((m) => newMemoryIds.has(m.memoryId)));
    await db.memories.bulkPut(add);
  });
  onProgress({ ratio: 1, label: '完了' });
  return { added: add.length, skipped: memories.length - add.length, files: filesWritten };
}

import exifr from 'exifr/dist/lite.esm.mjs';
import { newId } from '../data/repository';
import type { MediaDraft } from '../data/types';

const PHOTO_MAX = 2048; // 保存する写真の長辺（容量節約）
const THUMB_MAX = 480;
export const MAX_VIDEO_MB = 100;

/** 選んだファイルを、保存用のメディアに変換する */
export async function importFile(file: File): Promise<MediaDraft> {
  if (file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name)) return importVideo(file);
  return importPhoto(file);
}

/**
 * 写真はいつも JPEG にして保存する。
 * iPhone の HEIC もここで JPEG に変換されるので、どの画面でも表示できる。
 */
async function importPhoto(file: File): Promise<MediaDraft> {
  const exifDate = await readExifDate(file);

  const src = await decodeImage(file);
  try {
    const photo = await toJpeg(src.image, src.width, src.height, PHOTO_MAX, 0.86);
    const thumb = await toJpeg(src.image, src.width, src.height, THUMB_MAX, 0.75);
    return {
      id: newId(),
      memoryId: '',
      kind: 'photo',
      file: photo,
      thumbFile: thumb,
      hasThumb: true,
      ...pickDate(exifDate, 'exif', file),
    };
  } finally {
    src.close();
  }
}

/** 画像を読み込む。まず createImageBitmap、だめなら <img>（Safari の HEIC 対応を使う） */
async function decodeImage(file: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; close(): void }> {
  try {
    const bmp = await createImageBitmap(file);
    return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) throw new Error('empty');
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('この写真の形式は読み込めませんでした');
    }
  }
}

async function importVideo(file: File): Promise<MediaDraft> {
  if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
    throw new Error(`${MAX_VIDEO_MB}MBを超える動画は追加できません（短めの動画がおすすめです）`);
  }
  const videoDate = await readVideoDate(file).catch(() => undefined);
  const thumb = await videoFirstFrame(file).catch(() => undefined);
  return {
    id: newId(),
    memoryId: '',
    kind: 'video',
    file: new Blob([await file.arrayBuffer()], { type: file.type || 'video/mp4' }),
    thumbFile: thumb,
    hasThumb: !!thumb,
    ...pickDate(videoDate, 'video', file),
  };
}

/**
 * 日付の決め方：撮影日 → ファイルの日付 → （保存時に）記録の日付。
 * ファイルの日付はコピーや選び方で変わることがあるので「参考」扱い。
 */
function pickDate(taken: number | undefined, source: 'exif' | 'video', file: File): Pick<MediaDraft, 'takenAt' | 'dateSource'> {
  if (taken) return { takenAt: taken, dateSource: source };
  if (file.lastModified) return { takenAt: file.lastModified, dateSource: 'file' };
  return { takenAt: undefined, dateSource: undefined };
}

const validDate = (d: unknown): number | undefined =>
  d instanceof Date && !isNaN(d.getTime()) && d.getTime() > Date.UTC(1990, 0) && d.getTime() < Date.now() + 864e5 ? d.getTime() : undefined;

/** 写真の撮影日（EXIF）。撮影した瞬間 → データ作成日 の順に探す */
export async function readExifDate(file: Blob): Promise<number | undefined> {
  try {
    const exif = await exifr.parse(file);
    return validDate(exif?.DateTimeOriginal) ?? validDate(exif?.CreateDate) ?? validDate(exif?.DateTimeDigitized);
  } catch {
    return undefined; // EXIFなし
  }
}

/** 動画の撮影日。iPhone の動画は「com.apple.quicktime.creationdate」（現地時刻）を優先 */
async function readVideoDate(file: Blob): Promise<number | undefined> {
  return (await readQuickTimeCreationDate(file)) ?? (await readMp4CreationTime(file));
}

function ends(file: Blob) {
  const CHUNK = 1024 * 1024;
  const parts = [file.slice(0, CHUNK)];
  if (file.size > CHUNK) parts.push(file.slice(Math.max(CHUNK, file.size - CHUNK)));
  return parts;
}

async function readQuickTimeCreationDate(file: Blob): Promise<number | undefined> {
  for (const part of ends(file)) {
    const text = new TextDecoder('latin1').decode(await part.arrayBuffer());
    if (!text.includes('com.apple.quicktime.creationdate')) continue;
    const m = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})/);
    if (m) return validDate(new Date(`${m[1]}${m[2]}:${m[3]}`));
  }
  return undefined;
}

function toJpeg(src: CanvasImageSource, w: number, h: number, max: number, q: number) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((ok, ng) =>
    canvas.toBlob((b) => (b && b.size ? ok(b) : ng(new Error('JPEGに変換できませんでした'))), 'image/jpeg', q),
  );
}

/**
 * 動画の最初のフレームを画像にする。
 * iPhone は一度再生しないと映像を読み込まないので、消音で一瞬再生してから描く。
 */
function videoFirstFrame(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    Object.assign(v.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
    let done = false;
    const finish = (err?: Error, blob?: Blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
      URL.revokeObjectURL(url);
      if (blob) resolve(blob);
      else reject(err ?? new Error('thumbnail'));
    };
    const timer = setTimeout(() => finish(new Error('timeout')), 8000);
    const capture = async () => {
      if (!v.videoWidth) return;
      try {
        finish(undefined, await toJpeg(v, v.videoWidth, v.videoHeight, THUMB_MAX, 0.75));
      } catch (e) {
        finish(e as Error);
      }
    };
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.onloadeddata = () => {
      v.currentTime = 0.05;
    };
    v.onseeked = capture;
    v.onerror = () => finish(new Error('video'));
    document.body.appendChild(v);
    v.src = url;
    v.play()
      .then(() => {
        v.pause();
        if (v.readyState >= 2) v.currentTime = 0.05;
      })
      .catch(() => {});
  });
}

/**
 * MP4/MOV の中の「mvhd」から撮影日時を読む。
 * 情報はファイルの先頭か末尾にあることが多いので、両端だけ読む。
 */
async function readMp4CreationTime(file: Blob): Promise<number | undefined> {
  for (const part of ends(file)) {
    const buf = new Uint8Array(await part.arrayBuffer());
    for (let i = 0; i < buf.length - 24; i++) {
      // 'm' 'v' 'h' 'd'
      if (buf[i] === 0x6d && buf[i + 1] === 0x76 && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const dv = new DataView(buf.buffer, buf.byteOffset + i + 4);
        const version = dv.getUint8(0);
        const secs = version === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
        if (!secs) return undefined;
        const ms = (secs - 2082844800) * 1000; // 1904年基準 → 1970年基準
        // あり得ない日付は無視
        if (ms < Date.UTC(1990, 0) || ms > Date.now() + 864e5) return undefined;
        return ms;
      }
    }
  }
  return undefined;
}

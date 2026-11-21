import exifr from 'exifr/dist/lite.esm.mjs';
import { newId } from '../data/repository';
import type { MediaItem } from '../data/types';

const PHOTO_MAX = 2048; // 保存する写真の長辺（容量節約）
const THUMB_MAX = 480;

/** 選んだファイルを、保存用のメディアに変換する */
export async function importFile(file: File): Promise<MediaItem | null> {
  if (file.type.startsWith('image/')) return importPhoto(file);
  if (file.type.startsWith('video/')) return importVideo(file);
  return null;
}

async function importPhoto(file: File): Promise<MediaItem> {
  let takenAt: number | undefined;
  try {
    const exif = await exifr.parse(file);
    const d: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (d instanceof Date && !isNaN(d.getTime())) takenAt = d.getTime();
  } catch {
    /* EXIFなし */
  }

  let blob: Blob = file;
  let thumb: Blob | undefined;
  try {
    const bmp = await createImageBitmap(file);
    blob = (await resize(bmp, bmp.width, bmp.height, PHOTO_MAX, 0.85)) ?? file;
    thumb = (await resize(bmp, bmp.width, bmp.height, THUMB_MAX, 0.75)) ?? undefined;
    bmp.close();
  } catch {
    /* 読めない形式（例：一部ブラウザでのHEIC）はそのまま保存 */
  }

  return {
    id: newId(),
    memoryId: '',
    kind: 'photo',
    blob,
    thumb,
    takenAt: takenAt ?? fallbackDate(file),
  };
}

async function importVideo(file: File): Promise<MediaItem> {
  const takenAt = (await readMp4CreationTime(file)) ?? fallbackDate(file);
  const thumb = await videoThumbnail(file).catch(() => undefined);
  return { id: newId(), memoryId: '', kind: 'video', blob: file, thumb, takenAt };
}

function fallbackDate(file: File): number | undefined {
  // lastModified はコピーで変わることもあるので「参考値」
  return file.lastModified || undefined;
}

function resize(src: CanvasImageSource, w: number, h: number, max: number, q: number) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q));
}

function videoThumbnail(file: Blob): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (b?: Blob) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(b);
    };
    const timer = setTimeout(() => done(undefined), 6000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = async () => {
      if (!v.videoWidth) return done(undefined);
      done((await resize(v, v.videoWidth, v.videoHeight, THUMB_MAX, 0.75)) ?? undefined);
    };
    v.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('video'));
    };
    v.src = url;
  });
}

/**
 * MP4/MOV の中の「mvhd」から撮影日時を読む。
 * 情報はファイルの先頭か末尾にあることが多いので、両端だけ読む。
 */
async function readMp4CreationTime(file: Blob): Promise<number | undefined> {
  const CHUNK = 1024 * 1024;
  const parts = [file.slice(0, CHUNK)];
  if (file.size > CHUNK) parts.push(file.slice(Math.max(CHUNK, file.size - CHUNK)));
  for (const part of parts) {
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

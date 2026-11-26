/* 取り込んだ動画を、スマホで見るのに十分な画質（短い辺が720ピクセル・1秒30コマ）に縮める。
 * 動画の変換部品（Mediabunny）は大きいので、縮めるときに初めて読み込む。
 * 縮められない端末・形式のときや、縮めても小さくならないときは null を返す（元の動画のまま保存する）。 */

const SHORT_SIDE = 720;
const VIDEO_BITRATE = 2_500_000; // 1分で約19MB（音を含めて約20MB）
const AUDIO_BITRATE = 128_000;

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
}

export async function compressVideo(file: Blob, onProgress?: (ratio: number) => void): Promise<CompressResult | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const w = track.displayWidth;
    const h = track.displayHeight;
    const short = Math.min(w, h);
    // もう十分小さい動画は、そのまま
    if (short <= SHORT_SIDE && file.size < 25 * 1024 * 1024) return null;
    const scale = Math.min(1, SHORT_SIDE / short);
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    const tw = even(w);
    const th = even(h);
    if (!(await mb.canEncodeVideo('avc', { width: tw, height: th, bitrate: VIDEO_BITRATE }).catch(() => false))) return null;
    // 音を変換し直す必要があるとき、端末に音の変換機能がなければ、アプリに入れた変換の部品を使う
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && audioTrack.codec !== 'aac' && !(await mb.canEncodeAudio('aac').catch(() => false))) {
      try {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
      } catch {
        /* 音をそのまま写せるなら、なくても大丈夫 */
      }
    }
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const conv = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      // ハードウェアの使い方は端末に任せる（決め打ちすると、使えない環境で失敗するため）
      video: { width: tw, height: th, fit: 'contain', codec: 'avc', bitrate: VIDEO_BITRATE, frameRate: 30 },
      // 音：iPhone の動画の音（AAC）は、そのまま写す（変換し直さない）。ほかの形式だけ AAC に変換する
      audio: (t) => (t.codec === 'aac' ? { codec: 'aac' } : { codec: 'aac', bitrate: AUDIO_BITRATE }),
    });
    if (!conv.isValid) return null;
    conv.onProgress = (p) => onProgress?.(p);
    await conv.execute();
    const buf = output.target.buffer;
    if (!buf || buf.byteLength >= file.size) return null; // 縮めても小さくならなかった
    return { blob: new Blob([buf], { type: 'video/mp4' }), width: tw, height: th };
  } catch {
    return null;
  } finally {
    input.dispose?.();
  }
}

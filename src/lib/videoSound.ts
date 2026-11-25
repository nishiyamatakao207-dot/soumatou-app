import { loadFile } from '../data/repository';

/* 再生画面で、動画の音を鳴らすために、動画から音だけを取り出す（覚えておいて使い回す）。
 * まずブラウザの音の読み込みで試し、だめなら書き出し用の部品（Mediabunny）で読む。 */

const cache = new Map<string, Promise<AudioBuffer | null>>();
const MAX = 4;

async function decode(id: string): Promise<AudioBuffer | null> {
  const blob = await loadFile(id);
  if (!blob) return null;
  try {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
    }
    return peak > 0.002 ? buf : null;
  } catch {
    // iPhone の動画（.MOV）を読めないブラウザ向け（大きい部品なので、必要なときだけ読み込む）
    const { decodeVideoAudio } = await import('./exporter');
    return (await decodeVideoAudio(blob)).buf;
  }
}

/** 動画（media の id）の音。音がない・読めないときは null */
export function videoAudio(id: string): Promise<AudioBuffer | null> {
  let p = cache.get(id);
  if (!p) {
    p = decode(id).catch(() => null);
    cache.set(id, p);
    // 古いものから捨てる（メモリを使いすぎないように）
    while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

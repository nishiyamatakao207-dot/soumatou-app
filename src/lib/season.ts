import { seeded } from './movie';

/* 季節の雰囲気：春は桜の花びら、夏は夜のほたる、秋は紅葉、冬は雪。
 * 再生画面（CSS）と動画の書き出し（キャンバス）で同じ動きになるよう、
 * 粒の大きさ・速さなどはここで数字として決めておく。 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type ParticleKind = 'petal' | 'firefly' | 'leaf' | 'snow';

/** 日本の季節：3〜5月 春、6〜8月 夏、9〜11月 秋、12〜2月 冬 */
export function seasonOf(ms: number): Season {
  const m = new Date(ms).getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

export const SEASON_LABEL: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

interface SeasonLook {
  kind: ParticleKind;
  colors: string[];
  count: number;
}

export const SEASON_LOOK: Record<Season, SeasonLook> = {
  spring: { kind: 'petal', colors: ['#ffc6d9', '#ffdbe6', '#f6a9c6', '#ffe9ef'], count: 18 },
  summer: { kind: 'firefly', colors: ['#eaff9c', '#cdff80', '#fff6a8'], count: 16 },
  autumn: { kind: 'leaf', colors: ['#e8763c', '#d4482c', '#f0a23a', '#b9472b'], count: 16 },
  winter: { kind: 'snow', colors: ['#ffffff', '#f1f7ff', '#dde9ff'], count: 26 },
};

/** 1つの粒の動き。落ちる粒（花びら・葉・雪）は上から下へ、ほたるはその場で漂いながら明滅する */
export interface Particle {
  kind: ParticleKind;
  color: string;
  /** 横の位置（%） */
  left: number;
  /** ほたるの縦の位置（%） */
  top: number;
  /** 大きさ（px） */
  size: number;
  /** 落ちるのにかかる秒数（ほたるは漂う周期） */
  fall: number;
  /** 左右にゆれる周期（秒）と幅（px） */
  sway: number;
  swayPx: number;
  /** 落ちる間に横へ流れる量（px）、回転（度） */
  drift: number;
  spin: number;
  /** 動きの始まりをずらす（秒） */
  delay: number;
  /** ほたるの明滅の周期（秒） */
  blink: number;
}

const cache = new Map<string, Particle[]>();

export function particles(season: Season, count = SEASON_LOOK[season].count): Particle[] {
  const key = `${season}:${count}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = SEASON_LOOK[season];
  const rnd = seeded(`season-${season}`);
  const list = Array.from({ length: count }, (): Particle => {
    const kind = look.kind;
    const size =
      kind === 'petal' ? 9 + rnd() * 7 : kind === 'leaf' ? 10 + rnd() * 9 : kind === 'snow' ? 5 + rnd() * 7 : 5 + rnd() * 6;
    return {
      kind,
      color: look.colors[Math.floor(rnd() * look.colors.length)],
      left: rnd() * 100,
      top: 8 + rnd() * 84,
      size,
      fall: kind === 'snow' ? 14 + rnd() * 12 : kind === 'firefly' ? 7 + rnd() * 8 : 11 + rnd() * 9,
      sway: 2.5 + rnd() * 3,
      swayPx: kind === 'snow' ? 8 + rnd() * 10 : kind === 'firefly' ? 0 : 14 + rnd() * 20,
      drift: (rnd() - 0.3) * 80,
      spin: kind === 'snow' ? 0 : (rnd() < 0.5 ? -1 : 1) * (180 + rnd() * 360),
      delay: rnd() * 25,
      blink: 1.6 + rnd() * 2.4,
    };
  });
  cache.set(key, list);
  return list;
}

/**
 * 背景に足す季節の色（透明な色のグラデーション）。
 * 再生画面の CSS と、動画書き出しのキャンバスの両方でこの数字を使う。
 * x, y：中心（0〜1）、rx, ry：半径（画面の幅・高さに対する割合）
 */
export interface Tint {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
}
export const SEASON_TINT: Record<Season, Tint[]> = {
  spring: [
    { x: 0.2, y: 0, rx: 0.9, ry: 0.6, color: 'rgba(255,168,200,0.34)' },
    { x: 0.85, y: 0.95, rx: 0.7, ry: 0.45, color: 'rgba(255,200,220,0.18)' },
  ],
  summer: [
    { x: 0.5, y: -0.1, rx: 1.1, ry: 0.7, color: 'rgba(24,36,96,0.5)' },
    { x: 0.8, y: 1, rx: 0.8, ry: 0.5, color: 'rgba(120,255,180,0.12)' },
  ],
  autumn: [
    { x: 0.5, y: 1.1, rx: 1, ry: 0.7, color: 'rgba(232,112,40,0.36)' },
    { x: 0.1, y: 0.1, rx: 0.6, ry: 0.4, color: 'rgba(200,70,40,0.16)' },
  ],
  winter: [
    { x: 0.5, y: -0.1, rx: 1, ry: 0.6, color: 'rgba(205,228,255,0.34)' },
    { x: 0.2, y: 0.9, rx: 0.7, ry: 0.45, color: 'rgba(170,200,255,0.14)' },
  ],
};

/** CSS の背景（画面用） */
export const tintCss = (season: Season) =>
  SEASON_TINT[season]
    .map((t) => `radial-gradient(ellipse ${t.rx * 100}% ${t.ry * 100}% at ${t.x * 100}% ${t.y * 100}%, ${t.color} 0%, transparent 70%)`)
    .join(', ');

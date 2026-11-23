import { useEffect, useMemo, useState } from 'react';
import { listDatedItems } from '../data/repository';
import { formatDate } from '../lib/format';
import { seeded } from '../lib/movie';
import { SEASON_LABEL, seasonOf, tintCss } from '../lib/season';
import { navigate } from '../router';
import { SeasonParticles } from './SeasonParticles';

/* トップ画面の星空。記録1つにつき星が1つ灯り、タップするとその記録が開く。
 * 左が古い記録、右が新しい記録。同じ年の星は淡い線でつながり、星座のようになる。
 * 新しく増えた星は、流れ星になって落ちてきてから光る。 */

const SKY_H = 230;
const SEEN_KEY = 'meguru.sky.seen';
const MILESTONES = [10, 30, 50, 100, 200, 365, 500, 1000];
/** 瞬く星の上限（多すぎると重くなるため） */
const TWINKLE_MAX = 80;

interface Star {
  id: string;
  date: number;
  createdAt: number;
  photos: number;
  feeling: boolean;
  x: number;
  y: number;
  size: number;
  year: number;
  twinkle: boolean;
  tw: number;
  delay: number;
}

function readSeen(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeSeen(v: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(v));
  } catch {
    /* 保存できなくても動く */
  }
}

export function StarSky() {
  const [raw, setRaw] = useState<Omit<Star, 'x' | 'y' | 'size' | 'year' | 'twinkle' | 'tw' | 'delay'>[]>();
  const [born, setBorn] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string>();
  const season = seasonOf(Date.now());

  useEffect(() => {
    (async () => {
      const items = await listDatedItems();
      const map = new Map<string, { id: string; date: number; createdAt: number; photos: number; feeling: boolean }>();
      for (const it of items) {
        const m = it.memory;
        const s = map.get(m.id) ?? { id: m.id, date: m.date, createdAt: m.createdAt, photos: 0, feeling: !!m.text.trim() };
        if (it.media) s.photos++;
        if (it.media?.caption?.trim()) s.feeling = true;
        map.set(m.id, s);
      }
      const list = [...map.values()].sort((a, b) => a.date - b.date);
      setRaw(list);

      // 前回見たときより後に作られた記録は「新しい星」
      const seen = readSeen();
      const newest = Math.max(0, ...list.map((s) => s.createdAt));
      if (seen != null) {
        const fresh = list.filter((s) => s.createdAt > seen);
        if (fresh.length) {
          setBorn(new Set(fresh.map((s) => s.id)));
          const total = list.length;
          const passed = MILESTONES.filter((m) => total >= m && total - fresh.length < m).pop();
          setToast(
            passed
              ? `✦ ${passed}個目の星が灯りました！ 夜空がにぎやかになってきました`
              : fresh.length === 1
                ? `✦ 星がひとつ増えました（ぜんぶで${total}個）`
                : `✦ 星が${fresh.length}つ増えました（ぜんぶで${total}個）`,
          );
        }
      } else if (list.length) {
        setToast('✦ 記録ひとつにつき、星がひとつ灯ります');
      }
      if (newest) writeSeen(newest);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  const stars: Star[] = useMemo(() => {
    if (!raw) return [];
    const n = raw.length;
    return raw.map((s, i) => {
      const rnd = seeded(`star-${s.id}`);
      // 横は時間の順（左が古い）、少しばらつかせる。縦はばらばら
      const slot = 88 / Math.max(1, n);
      const x = 6 + slot * (i + 0.5) + (rnd() - 0.5) * slot * 0.8;
      const y = 14 + rnd() * 62;
      return {
        ...s,
        x,
        y,
        size: 3.4 + Math.min(5, s.photos) * 0.6 + (s.feeling ? 1 : 0),
        year: new Date(s.date).getFullYear(),
        twinkle: i >= n - TWINKLE_MAX,
        tw: 2.4 + rnd() * 3.5,
        delay: rnd() * 4,
      };
    });
  }, [raw]);

  // 同じ年の星を、日付の順に線でつなぐ（星座）
  const lines = useMemo(() => {
    const byYear = new Map<number, Star[]>();
    stars.forEach((s) => byYear.set(s.year, [...(byYear.get(s.year) ?? []), s]));
    return [...byYear.values()].filter((g) => g.length > 1).map((g) => g.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`).join(' '));
  }, [stars]);

  const bornOrder = stars.filter((s) => born.has(s.id)).map((s) => s.id);

  return (
    <section className={`sky sky-${season}`} style={{ height: SKY_H }} aria-label="思い出の星空">
      <div className="sky-tint" style={{ background: tintCss(season) }} />
      <div className="sky-dust" />
      <SeasonParticles season={season} count={12} height={SKY_H} />
      <svg className="sky-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {lines.map((pts, i) => (
          <polyline key={i} points={pts} />
        ))}
      </svg>
      {stars.map((s) => {
        const order = bornOrder.indexOf(s.id);
        return (
          <button
            key={s.id}
            className={`star ${s.feeling ? 'bright' : ''} ${s.twinkle ? 'twinkle' : ''} ${order >= 0 ? 'born' : ''}`}
            style={
              {
                left: `${s.x}%`,
                top: `${s.y}%`,
                ['--s' as string]: `${s.size.toFixed(1)}px`,
                ['--tw' as string]: `${s.tw.toFixed(2)}s`,
                ['--d' as string]: `${(order >= 0 ? 0.6 + order * 0.45 : s.delay).toFixed(2)}s`,
              } as React.CSSProperties
            }
            onClick={() => navigate(`/edit/${encodeURIComponent(s.id)}`)}
            aria-label={`${formatDate(s.date)}の思い出を開く`}
          >
            {order >= 0 && <span className="meteor" />}
            <span className="star-core" />
          </button>
        );
      })}
      <div className="sky-label">
        {SEASON_LABEL[season]}の夜空
      </div>
      <div className="sky-count">
        {raw && raw.length === 0 ? '思い出を残すと、ここに星がひとつ灯ります' : raw ? `✦ ${raw.length}の思い出が星になりました` : ''}
      </div>
      {toast && <div className="sky-toast">{toast}</div>}
    </section>
  );
}

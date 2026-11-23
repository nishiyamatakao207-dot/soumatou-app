import { useEffect, useState } from 'react';
import { filterToQuery } from '../lib/filter';
import { dismissToday, dismissedToday, findOnThisDay, markShown, shownToday, yearsLabel, type OnThisDay } from '../lib/onThisDay';
import { useSetting } from '../lib/settings';
import { navigate } from '../router';
import { Thumb } from './Thumb';

/** アプリを開いてから最初の1回だけ、大きなお知らせを出す（記録を保存して戻ったときなどには出さない） */
let launchChecked = false;

/**
 * ◯年前の今日のお知らせ。
 * その日はじめて開いたときは画面の真ん中に大きく出し、そのあとは一覧の上に小さなカードで残す。
 */
export function OnThisDayCard() {
  const [enabled] = useSetting('onThisDay');
  const [otd, setOtd] = useState<OnThisDay | null>(null);
  const [big, setBig] = useState(false);
  const [hidden, setHidden] = useState(dismissedToday());

  useEffect(() => {
    if (!enabled) return;
    const atLaunch = !launchChecked;
    launchChecked = true;
    findOnThisDay().then((r) => {
      setOtd(r);
      if (r && atLaunch && !shownToday() && !dismissedToday()) {
        setBig(true);
        markShown();
      }
    });
  }, [enabled]);

  if (!enabled || !otd || hidden) return null;

  const play = () => navigate(`/play?${filterToQuery({ tags: [], period: 'all', day: otd.day })}`);
  const [m, d] = otd.day.split('-').map(Number);
  const title = yearsLabel(otd.yearsAgo);

  const thumbs = (
    <div className="otd-thumbs">
      {otd.thumbs.map((t) => (
        <Thumb key={t.id} item={t} />
      ))}
    </div>
  );

  return (
    <>
      <section className="otd-card" aria-label={title}>
        <div className="otd-head">
          <span className="otd-badge">✦ {title}</span>
          <button
            className="otd-close"
            aria-label="今日は閉じる"
            onClick={() => {
              dismissToday();
              setHidden(true);
            }}
          >
            ×
          </button>
        </div>
        <div className="otd-body">
          {thumbs}
          <div className="otd-text">
            <p>
              {m}月{d}日の思い出が{otd.count}つあります
            </p>
            <button className="btn primary small" onClick={play}>
              ▶ 見る
            </button>
          </div>
        </div>
      </section>

      {big && (
        <div className="otd-modal" role="dialog" aria-modal="true" aria-label={title}>
          <div className="otd-sheet">
            <p className="otd-kicker">今日は {m}月{d}日</p>
            <h2 className="otd-title">{title}</h2>
            {thumbs}
            <p className="muted small">あの日の思い出が{otd.count}つ見つかりました</p>
            <button
              className="btn primary big"
              onClick={() => {
                setBig(false);
                play();
              }}
            >
              ▶ 走馬灯で見る
            </button>
            <button className="btn ghost" onClick={() => setBig(false)}>
              あとで
            </button>
          </div>
        </div>
      )}
    </>
  );
}

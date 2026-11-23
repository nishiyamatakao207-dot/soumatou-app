import { useEffect } from 'react';
import { navigate, useRoute } from './router';
import { Timeline } from './screens/Timeline';
import { Editor } from './screens/Editor';
import { Player } from './screens/Player';
import { Export } from './screens/Export';
import { AddFeeling } from './screens/AddFeeling';
import { Settings } from './screens/Settings';
import { readSetting } from './lib/settings';
import { DIGEST_AGAIN_MS, digestAvailable } from './lib/digest';

/** 一覧画面にいるときだけ、「今日のひとめぐり」に切り替える */
async function maybeShowDigest() {
  if (!readSetting('dailyDigest')) return;
  const h = location.hash.replace(/^#/, '');
  const onTimeline = h === '' || h === '/' || h.startsWith('/?');
  if (!onTimeline) return;
  // 「戻る」で同じ一覧が2回出ないよう、履歴を置きかえる
  if (await digestAvailable()) navigate('/digest', true);
}

export function App() {
  const route = useRoute();

  // アプリを開いたとき・しばらくぶりに戻ってきたときに流す
  useEffect(() => {
    void maybeShowDigest();
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= DIGEST_AGAIN_MS) void maybeShowDigest();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  switch (route.name) {
    case 'new':
      return <Editor key={route.voice ? 'voice' : 'new'} voice={route.voice} />;
    case 'feel':
      return <AddFeeling id={route.id} />;
    case 'edit':
      return <Editor key={route.id} id={route.id} />;
    case 'play':
      return <Player query={route.query} />;
    case 'digest':
      return <Player key="digest" query="" digest />;
    case 'export':
      return <Export query={route.query} />;
    case 'settings':
      return <Settings />;
    default:
      return <Timeline query={route.query} />;
  }
}

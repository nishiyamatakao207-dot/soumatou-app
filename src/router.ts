import { useEffect, useState } from 'react';

/* とても小さな画面切り替え（URLの # 以降で管理）。
 * 戻るボタンが効き、ネイティブ化してもそのまま動く。 */

export type Route =
  | { name: 'timeline'; query: string }
  | { name: 'new'; voice: boolean }
  | { name: 'feel'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'play'; query: string }
  | { name: 'export'; query: string };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'new') return { name: 'new', voice: new URLSearchParams(query).get('voice') === '1' };
  if (seg[0] === 'feel' && seg[1]) return { name: 'feel', id: decodeURIComponent(seg[1]) };
  if (seg[0] === 'edit' && seg[1]) return { name: 'edit', id: decodeURIComponent(seg[1]) };
  if (seg[0] === 'play') return { name: 'play', query };
  if (seg[0] === 'export') return { name: 'export', query };
  return { name: 'timeline', query };
}

export function navigate(to: string, replace = false) {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

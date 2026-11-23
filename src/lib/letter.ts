/* 未来への手紙：日付まわりの計算 */

/** その日の0時（この端末の時刻）。'YYYY-MM-DD' から */
export function dayStart(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function toYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 今日から n 年後の同じ日 */
export function yearsLater(n: number, from = Date.now()): string {
  const d = new Date(from);
  return toYmd(new Date(d.getFullYear() + n, d.getMonth(), d.getDate()).getTime());
}

/** 明日（これより前の日付は選べない） */
export const tomorrow = () => {
  const d = new Date();
  return toYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
};

/** 開けられる日までの残り（例：あと18年4か月、あと3日） */
export function countdown(until: number, now = Date.now()): string {
  if (now >= until) return '開けられます';
  const a = new Date(now);
  const b = new Date(until);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years >= 1) return `あと${years}年${rest ? `${rest}か月` : ''}`;
  if (months >= 1) return `あと${months}か月`;
  const days = Math.ceil((until - now) / 864e5);
  return `あと${days}日`;
}

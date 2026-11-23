const dateFmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' });

export const formatDate = (ms: number) => dateFmt.format(ms);
export const formatMonth = (ms: number) => monthFmt.format(ms);

/** <input type="datetime-local"> 用の文字列 */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toDateInput(ms: number): string {
  return toLocalInput(ms).slice(0, 10);
}

/** 控えめな日付表示（例：2026.8.15） */
export function formatDot(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

/** 同じ日かどうかの判定用（この端末の時刻で） */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

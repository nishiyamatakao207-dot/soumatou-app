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

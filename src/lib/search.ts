/* キーワード検索：気持ちの言葉（ひとこと・写真のコメント）とタグから探す。
 * 全角・半角、大文字・小文字、カタカナ・ひらがなの違いは同じものとして扱う（「ウミ」で「うみ」も見つかる）。 */

export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 検索の言葉を、空白で区切った単語に分ける（すべての単語を含むものを探す） */
export const searchWords = (q: string) => normalize(q).split(' ').filter(Boolean);

/** text の中に、words のすべてが含まれるか（words は normalize 済み） */
export const matchesAll = (text: string, words: string[]) => words.every((w) => text.includes(w));

export interface InlineTagMatch {
  start: number;
  end: number;
  name: string;
}

const INLINE_TAG_NAME = /[\p{L}\p{N}_-]/u;

export function findInlineTagMatches(text: string): InlineTagMatch[] {
  const matches: InlineTagMatch[] = [];
  const symbols = Array.from(text);
  const offsets: number[] = [];
  let codeUnitOffset = 0;

  for (const symbol of symbols) {
    offsets.push(codeUnitOffset);
    codeUnitOffset += symbol.length;
  }
  offsets.push(codeUnitOffset);

  for (let index = 0; index < symbols.length; index += 1) {
    if (symbols[index] !== "#") continue;

    const start = offsets[index];
    const prefix = text.slice(0, start);
    if (prefix.endsWith("://") || prefix.endsWith("/")) continue;

    const previous = index === 0 ? null : symbols[index - 1];
    if (previous !== null && !/\s/u.test(previous)) continue;

    let endIndex = index + 1;
    while (endIndex < symbols.length && INLINE_TAG_NAME.test(symbols[endIndex])) {
      endIndex += 1;
    }
    if (endIndex === index + 1) continue;

    const end = offsets[endIndex];
    matches.push({
      start,
      end,
      name: text.slice(offsets[index + 1], end),
    });
  }

  return matches;
}
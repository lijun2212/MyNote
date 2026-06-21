export interface InlineTagMatch {
  start: number;
  end: number;
  name: string;
}

const INLINE_TAG_NAME = /[\p{L}\p{N}_-]/u;
const INLINE_TAG_PREFIX = "[[#";
const INLINE_TAG_SUFFIX = "]]";

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
    if (symbols[index] !== "[" || symbols[index + 1] !== "[" || symbols[index + 2] !== "#") {
      continue;
    }

    const start = offsets[index];
    let endIndex = index + 3;
    while (endIndex < symbols.length && INLINE_TAG_NAME.test(symbols[endIndex])) {
      endIndex += 1;
    }
    if (endIndex === index + 3) continue;
    if (symbols[endIndex] !== "]" || symbols[endIndex + 1] !== "]") continue;

    const end = offsets[endIndex + 2];
    matches.push({
      start,
      end,
      name: text.slice(offsets[index + 3], offsets[endIndex]),
    });

    index = endIndex + 1;
  }

  return matches;
}

export function buildInlineTagText(tagName: string): string {
  return `${INLINE_TAG_PREFIX}${tagName}${INLINE_TAG_SUFFIX}`;
}
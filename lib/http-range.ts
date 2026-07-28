export type HttpByteRange = {
  start: number;
  end: number;
};

export function parseHttpByteRange(range: string, size: number): HttpByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return null;

  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, size);
    return { start: size - length, end: size - 1 };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;

  const end = endText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(end) || end < start) return null;

  return { start, end: Math.min(end, size - 1) };
}

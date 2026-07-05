export interface ByteRange {
  start: number;
  end: number;
}

export class UnsatisfiableRangeError extends Error {
  constructor() {
    super('Range is not satisfiable');
  }
}

export function parseByteRange(
  rangeHeader: string | undefined,
  size: number,
): ByteRange | null {
  if (rangeHeader === undefined) {
    return null;
  }

  if (!Number.isInteger(size) || size <= 0) {
    throw new UnsatisfiableRangeError();
  }

  if (rangeHeader.includes(',')) {
    throw new UnsatisfiableRangeError();
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    throw new UnsatisfiableRangeError();
  }

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    throw new UnsatisfiableRangeError();
  }

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new UnsatisfiableRangeError();
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd === '' ? size - 1 : Number(rawEnd);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    throw new UnsatisfiableRangeError();
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

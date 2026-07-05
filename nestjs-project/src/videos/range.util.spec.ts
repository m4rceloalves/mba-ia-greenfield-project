import { parseByteRange, UnsatisfiableRangeError } from './range.util';

describe('parseByteRange', () => {
  it('should return null when no range header is provided', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
  });

  it('should parse bounded ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({
      start: 10,
      end: 19,
    });
  });

  it('should clamp range end to the object size', () => {
    expect(parseByteRange('bytes=90-999', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it('should parse open-ended ranges', () => {
    expect(parseByteRange('bytes=95-', 100)).toEqual({
      start: 95,
      end: 99,
    });
  });

  it('should parse suffix ranges', () => {
    expect(parseByteRange('bytes=-10', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it('should clamp suffix ranges longer than the object', () => {
    expect(parseByteRange('bytes=-200', 100)).toEqual({
      start: 0,
      end: 99,
    });
  });

  it('should reject unsupported or unsatisfiable ranges', () => {
    expect(() => parseByteRange('items=0-1', 100)).toThrow(
      UnsatisfiableRangeError,
    );
    expect(() => parseByteRange('bytes=10-1', 100)).toThrow(
      UnsatisfiableRangeError,
    );
    expect(() => parseByteRange('bytes=100-101', 100)).toThrow(
      UnsatisfiableRangeError,
    );
    expect(() => parseByteRange('bytes=0-1,2-3', 100)).toThrow(
      UnsatisfiableRangeError,
    );
  });

  it('should reject ranges when the object size is empty or invalid', () => {
    expect(() => parseByteRange('bytes=0-1', 0)).toThrow(
      UnsatisfiableRangeError,
    );
    expect(() => parseByteRange('bytes=0-1', Number.NaN)).toThrow(
      UnsatisfiableRangeError,
    );
  });
});

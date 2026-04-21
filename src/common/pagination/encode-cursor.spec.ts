import { decodeCursor, encodeCursor } from './encode-cursor';

describe('cursor encoding', () => {
  it('round-trips an id', () => {
    const id = 'clq1234abc';
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it('throws when decoding garbage', () => {
    expect(() => decodeCursor('%%%not-base64%%%')).toThrow(/invalid cursor/i);
  });
});

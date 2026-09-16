import { escapeIlikePattern, ilikeContains } from './like-escape.util';

describe('like-escape.util', () => {
  it('escapes % and _ literally', () => {
    expect(escapeIlikePattern('a%b_c')).toBe('a\\%b\\_c');
  });
  it('escapes backslash', () => {
    expect(escapeIlikePattern('a\\b')).toBe('a\\\\b');
  });
  it('escapes * and ,', () => {
    expect(escapeIlikePattern('a*b,c')).toBe('a\\*b\\,c');
  });
  it('ilikeContains wraps with %', () => {
    expect(ilikeContains('abc%')).toBe('%abc\\%%');
    expect(ilikeContains('a_b')).toBe('%a\\_b%');
    expect(ilikeContains('')).toBe('%%');
    expect(ilikeContains('%abc')).toBe('%\\%abc%');
    expect(ilikeContains('abc%def_')).toBe('%abc\\%def\\_%');
  });
});

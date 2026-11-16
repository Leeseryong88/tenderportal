import { describe, expect, it } from 'vitest';
import { compareLabels, matchesSearch } from '@/lib/text/collate';

describe('compareLabels', () => {
  it('orders Korean labels 가나다 and puts Hangul before Latin', () => {
    const sorted = ['미국', 'Zeta', '가나', '독일', 'Alpha', '나이지리아'].sort(compareLabels('ko'));
    expect(sorted).toEqual(['가나', '나이지리아', '독일', '미국', 'Alpha', 'Zeta']);
  });

  it('orders English labels case-insensitively with numeric awareness', () => {
    expect(['b', 'Item 10', 'A', 'Item 2'].sort(compareLabels('en'))).toEqual(['A', 'b', 'Item 2', 'Item 10']);
  });
});

describe('matchesSearch', () => {
  it('matches substrings ignoring case and spaces', () => {
    expect(matchesSearch('United States', 'unitedst')).toBe(true);
    expect(matchesSearch('대한민국 South Korea KR', 'korea')).toBe(true);
    expect(matchesSearch('Germany', 'fra')).toBe(false);
  });

  it('matches Korean initial consonants', () => {
    expect(matchesSearch('미국', 'ㅁㄱ')).toBe(true);
    expect(matchesSearch('대한민국', 'ㅁㄱ')).toBe(true);
    expect(matchesSearch('독일', 'ㅁㄱ')).toBe(false);
  });
});

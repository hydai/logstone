import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { AchievementsParser } from '../src/parsers/achievements-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// The achievement history with every copy of each text swapped. Each text is checked to be there, so a
// change to the fixture cannot turn a test into one that tests nothing.
const historyWith = (...swaps: Array<[from: string, to: string]>) =>
  swaps.reduce((html, [from, to]) => {
    if (!html.includes(from)) throw new Error(`achievement-na.html has no ${from}`);
    return html.replaceAll(from, to);
  }, fixture('achievement-na.html'));

// The history of a character with no achievement yet: the name in the frame and a total of 0.
const EMPTY_HISTORY =
  '<html><body><div class="ldst__window"><div class="frame__chara"><a class="frame__chara__link">' +
  '<div class="frame__chara__face"></div><div class="frame__chara__box"><p class="frame__chara__name">Hikari Senshi</p></div>' +
  '</a></div><div class="ldst__achievement"><div class="parts__total">0 Total</div></div></div></body></html>';

describe('AchievementsParser on the achievement history', () => {
  const data = new AchievementsParser().parse(fixture('achievement-na.html'));

  test('reads the time of each achievement from the script that writes it', () => {
    expect(data.Achievements.map(({ ID, Time }) => ({ ID, Time }))).toEqual([
      { ID: '4071', Time: '2023-11-14T22:13:20.000Z' },
      { ID: '591', Time: '2023-11-15T22:13:20.000Z' },
      { ID: '3957', Time: '2023-11-03T08:26:40.000Z' },
      // This entry has no script, so the page gives no date.
      { ID: '3436', Time: '' },
    ]);
  });

  test('reads the id and the name of each achievement', () => {
    expect(data.Achievements.map(({ ID, Name }) => ({ ID, Name }))).toEqual([
      { ID: '4071', Name: 'Masterstroke II' },
      { ID: '591', Name: 'Pimp Your Ride' },
      { ID: '3957', Name: 'Cut Above the Rest: Blade Occultum' },
      { ID: '3436', Name: 'Through the Gate X' },
    ]);
  });

  test('reads the total, the points and the page', () => {
    expect(data.TotalAchievements).toBe(512);
    expect(data.AchievementPoints).toBe('4320');
    expect(data.Pagination).toEqual({ Page: 1, PageTotal: 11, PageNext: 2, PagePrev: null });
  });
});

describe('the time of one achievement', () => {
  const CALL = "ldst_strftime(1700000000, 'YMD')";

  // The first entry of the fixture, with the call that writes its date swapped.
  const firstEntryWith = (call: string) => {
    const html = fixture('achievement-na.html');
    if (!html.includes(CALL)) throw new Error(`achievement-na.html has no ${CALL}`);
    return new AchievementsParser().parse(html.replace(CALL, call)).Achievements[0];
  };

  test('is the ISO time of the unix seconds the script writes', () => {
    expect(firstEntryWith("ldst_strftime(1500000000, 'YMD')")).toEqual({
      ID: '4071',
      Name: 'Masterstroke II',
      Time: '2017-07-14T02:40:00.000Z',
    });
  });

  test('is empty when the script gives no timestamp or 0', () => {
    expect(firstEntryWith("ldst_strftime(, 'YMD')").Time).toBe('');
    expect(firstEntryWith("ldst_strftime(0, 'YMD')").Time).toBe('');
  });

  test('is empty, and the achievement is still listed, when no date has that timestamp', () => {
    expect(firstEntryWith("ldst_strftime(99999999999999999, 'YMD')")).toEqual({
      ID: '4071',
      Name: 'Masterstroke II',
      Time: '',
    });
  });
});

// A page the parser does not know would be kept for two days as the character's history, so it is a
// ParseError instead. A history that really is empty stays an answer.
describe('a page that is not an achievement history the parser knows', () => {
  const NAME = '<p class="frame__chara__name">Hikari Senshi</p>';
  const parse = (html: string) => new AchievementsParser().parse(html);

  // The frame of every character page has the name, the pages that may not be viewed included.
  test.each([
    ['an empty page', '<html><body></body></html>'],
    ['only the window of a Lodestone page', '<html><body><div class="ldst__window"></div></body></html>'],
    ['the history without the name', historyWith([NAME, ''])],
    ['the history with an empty name', historyWith([NAME, '<p class="frame__chara__name"> </p>'])],
  ])('is a ParseError when it has no character name: %s', (_what, html) => {
    expect(() => parse(html)).toThrow(ParseError);
    expect(() => parse(html)).toThrow(/character name/);
  });

  // The name is in the frame of every character page, so it cannot tell the history from the profile,
  // which Lodestone could send after a redirect. The achievement section can: it is there even when the
  // history is empty.
  test.each([
    ['the character profile', fixture('profile-na.html')],
    ['the history without its achievement section', EMPTY_HISTORY.replace('class="ldst__achievement"', 'class="ldst__profile"')],
  ])('is a ParseError when it has no achievement section: %s', (_what, html) => {
    expect(() => parse(html)).toThrow(ParseError);
    expect(() => parse(html)).toThrow(/achievement section/);
  });

  test('is a ParseError when it counts achievements but has no row the parser can read', () => {
    const renamed = historyWith(['class="entry"', 'class="row"']);

    expect(() => parse(renamed)).toThrow(ParseError);
    expect(() => parse(renamed)).toThrow(/512/);
  });

  test('is an empty history, not an error, when it has the name and a total of 0', () => {
    expect(parse(EMPTY_HISTORY)).toMatchObject({ Achievements: [], TotalAchievements: 0 });
  });

  test('is an empty history, not an error, when it has the name but neither a total nor a row', () => {
    const page = EMPTY_HISTORY.replace('<div class="parts__total">0 Total</div>', '');
    if (page.includes('parts__total')) throw new Error('EMPTY_HISTORY still has a total');

    expect(parse(page)).toMatchObject({ Achievements: [], TotalAchievements: 0 });
  });
});

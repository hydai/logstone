import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { AchievementsParser } from '../src/parsers/achievements-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

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

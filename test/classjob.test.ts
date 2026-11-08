import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { ParseError } from '../src/lib/http';
import * as classjobSelectors from '../src/lib/lodestone-css-selectors/profile/classjob.json';
import { ClassJobParser } from '../src/parsers/classjob-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

type Jobs = Record<string, { Level?: string; UnlockState?: string }>;

// "<level> <name>" of every job in a group: the level and the name its own row shows.
// Two jobs with the same level still tell their rows apart by name.
const rowsOf = (jobs: Jobs) =>
  Object.fromEntries(Object.entries(jobs).map(([key, job]) => [key, `${job.Level} ${job.UnlockState}`]));

describe('ClassJobParser on the Class/Job page', () => {
  const data = new ClassJobParser().parse(fixture('classjob-na.html'));

  test('reads the 7.0 jobs, Beastmaster and Blue Mage from their own rows', () => {
    expect(data.CombatJobs.MeleeDPS.Viper.Level).toBe('80');
    expect(data.CombatJobs.MeleeDPS.Beastmaster.Level).toBe('50');
    expect(data.CombatJobs.MagicalDPS.Pictomancer.Level).toBe('91');
    expect(data.CombatJobs.MagicalDPS.BlueMage.Level).toBe('50');
  });

  test('reads the experience of the new and the moved rows from the same row as their level', () => {
    expect(data.CombatJobs.MeleeDPS.Viper).toMatchObject({ CurrentEXP: '0', MaxEXP: '5,992,000' });
    // Beastmaster is at its cap, so its row has no experience left to count.
    expect(data.CombatJobs.MeleeDPS.Beastmaster).toMatchObject({ CurrentEXP: '--', MaxEXP: '--' });
    expect(data.CombatJobs.MagicalDPS.Pictomancer).toMatchObject({ CurrentEXP: '1,010', MaxEXP: '13,659,000' });
    expect(data.CombatJobs.MagicalDPS.BlueMage).toMatchObject({ CurrentEXP: '1,011', MaxEXP: '421,000' });
  });

  test('puts every job in its role, each with the level and the name of its own row', () => {
    expect(rowsOf(data.CombatJobs.Tank)).toEqual({
      // Not unlocked: the row shows the base class and no level.
      Paladin: '- Gladiator',
      Warrior: '31 Warrior',
      DarkKnight: '- Dark Knight',
      Gunbreaker: '60 Gunbreaker',
    });
    expect(rowsOf(data.CombatJobs.Healer)).toEqual({
      WhiteMage: '100 White Mage',
      Scholar: '100 Scholar',
      Astrologian: '43 Astrologian',
      Sage: '70 Sage',
    });
    expect(rowsOf(data.CombatJobs.MeleeDPS)).toEqual({
      Monk: '70 Monk',
      Dragoon: '70 Dragoon',
      Ninja: '61 Ninja',
      Samurai: '80 Samurai',
      Reaper: '100 Reaper',
      Viper: '80 Viper',
      Beastmaster: '50 Beastmaster',
    });
    expect(rowsOf(data.CombatJobs.RangedDPS)).toEqual({
      Bard: '100 Bard',
      Machinist: '63 Machinist',
      Dancer: '83 Dancer',
    });
    expect(rowsOf(data.CombatJobs.MagicalDPS)).toEqual({
      BlackMage: '100 Black Mage',
      Summoner: '100 Summoner',
      RedMage: '60 Red Mage',
      Pictomancer: '91 Pictomancer',
      BlueMage: '50 Blue Mage',
    });
    expect(rowsOf(data.CraftingJobs)).toEqual({
      Carpenter: '74 Carpenter',
      Blacksmith: '66 Blacksmith',
      Armorer: '38 Armorer',
      Goldsmith: '36 Goldsmith',
      Leatherworker: '26 Leatherworker',
      Weaver: '38 Weaver',
      Alchemist: '43 Alchemist',
      Culinarian: '44 Culinarian',
    });
    expect(rowsOf(data.GatheringJobs)).toEqual({
      Miner: '91 Miner',
      Botanist: '100 Botanist',
      Fisher: '13 Fisher',
    });
  });

  test('has no Bozja or Eureka entry for a page without those blocks', () => {
    expect(data.SpecialContent).toEqual({});
  });
});

// The Class/Job page lists every job, the locked ones too. A page without a single row the parser can
// read is a layout it does not know, or another page: an answer without jobs would be kept for a day.
describe('a page without a class or job row', () => {
  test.each([
    ['an empty page', '<html><body></body></html>'],
    ['only the window of a Lodestone page', '<html><body><div class="ldst__window"></div></body></html>'],
    [
      'the Class/Job page with its rows no longer list items',
      fixture('classjob-na.html').replaceAll('<li>', '<div>').replaceAll('</li>', '</div>'),
    ],
  ])('is a ParseError: %s', (_what, html) => {
    expect(() => new ClassJobParser().parse(html)).toThrow(ParseError);
    expect(() => new ClassJobParser().parse(html)).toThrow(/class or job row/);
  });
});

describe('the groups of the class job answer', () => {
  // A row is filed under the group its key belongs to, and a key that no group takes would be
  // dropped from the answer without a word.
  test('take every key of classjob.json, each in exactly one group', () => {
    const keys = Object.keys(classjobSelectors).filter((key) => key !== 'default');
    const parser = new ClassJobParser();
    // Every key read as a row named after it, so the row can be told apart in the answer.
    vi.spyOn(parser as any, 'extractAllJobs').mockReturnValue(Object.fromEntries(keys.map((key) => [key, { Name: key }])));

    const data = parser.parse('');
    const groups = [...Object.values(data.CombatJobs), data.CraftingJobs, data.GatheringJobs, data.SpecialContent];

    // Without the keys this would check nothing.
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      const holding = groups.filter((group) => Object.values(group).some((job) => job.Name === key));
      expect(holding, key).toHaveLength(1);
    }
  });
});

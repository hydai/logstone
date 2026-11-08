import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { FreeCompanyMembersParser } from '../src/parsers/freecompany-members-parser';
import { FreeCompanyParser } from '../src/parsers/freecompany-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// The Japanese free company page with texts swapped. Each text is checked to be there, so a change to
// the fixture cannot turn a test into one that tests nothing.
const companyPageWith = (...swaps: Array<[from: string, to: string]>) =>
  swaps.reduce((html, [from, to]) => {
    if (!html.includes(from)) throw new Error(`freecompany-jp.html has no ${from}`);
    return html.replace(from, to);
  }, fixture('freecompany-jp.html'));

describe('FreeCompanyParser on the Japanese free company page', () => {
  const company = new FreeCompanyParser().parse(fixture('freecompany-jp.html'));

  test('reads the company the fixture describes', () => {
    expect(company).toMatchObject({
      ID: '9230000000000000002',
      Name: 'サンプルカンパニー',
      Server: { World: 'Tonberry', DC: 'Elemental' },
    });
    expect(company.CrestLayers).toHaveLength(3);
    expect(Object.keys(company.Reputation).sort()).toEqual(['ADDERS', 'FLAMES', 'MAELSTROM']);
  });

  test('reads the grand company and the standing with it, as the Japanese site writes them', () => {
    expect(company.GrandCompany).toEqual({ Name: '黒渦団', Rank: '盟友' });
  });

  test('reads the weekly and the monthly ranking without the 位 after the number', () => {
    expect(company.Ranking).toEqual({ Weekly: '12', Monthly: '34' });
  });
});

// The English site builds the page the same way and writes these lines in English.
describe('FreeCompanyParser on the English free company page', () => {
  const company = new FreeCompanyParser().parse(
    companyPageWith(
      ['黒渦団 &lt;盟友&gt;', 'Maelstrom &lt;Allied&gt;'],
      ['週間ランク:12位（前週）', 'Weekly Rank:12 (previous week)'],
      ['月間ランク:34位（前月）', 'Monthly Rank:34 (previous month)'],
    ),
  );

  test('reads the grand company without the space before its standing', () => {
    expect(company.GrandCompany).toEqual({ Name: 'Maelstrom', Rank: 'Allied' });
  });

  test('reads a grand company whose name has spaces', () => {
    const flames = new FreeCompanyParser().parse(
      companyPageWith(['黒渦団 &lt;盟友&gt;', 'Immortal Flames &lt;Friendly&gt;']),
    );

    expect(flames.GrandCompany).toEqual({ Name: 'Immortal Flames', Rank: 'Friendly' });
  });

  test('reads the weekly and the monthly ranking', () => {
    expect(company.Ranking).toEqual({ Weekly: '12', Monthly: '34' });
  });
});

// Every free company page shows the company's name. A page without it is a layout the parser does not
// know, or another page altogether: a company without a name would be kept for a day.
describe('FreeCompanyParser on a page without the company name', () => {
  const parse = (html: string) => new FreeCompanyParser().parse(html);
  const withName = (name: string) =>
    `<html><body><div class="ldst__window"><p class="freecompany__text__name">${name}</p></div></body></html>`;

  test('reads the name when the page has it', () => {
    expect(parse(withName('Example Company')).Name).toBe('Example Company');
  });

  test.each([
    ['an empty page', '<html><body></body></html>'],
    ['only the window of a Lodestone page', '<html><body><div class="ldst__window"></div></body></html>'],
    ['an empty name', withName('  ')],
  ])('is a ParseError: %s', (_what, html) => {
    expect(() => parse(html)).toThrow(ParseError);
    expect(() => parse(html)).toThrow(/company name/);
  });
});

// A free company has at least its master, so a member list without a single row the parser can read
// is not one it knows: an empty list would be kept for a day.
describe('FreeCompanyMembersParser on a page without a member row', () => {
  const parse = (html: string) => new FreeCompanyMembersParser().parse(html, 1);
  // One row, as members.json reads it: the link with the character ID, and the name.
  const ROW =
    '<li class="entry"><a href="/lodestone/character/12345678/" class="entry__bg"></a>' +
    '<p class="entry__name">Hikari Senshi</p></li>';
  const listOf = (row: string) => `<html><body><div class="ldst__window"><ul>${row}</ul></div></body></html>`;

  test('reads a row with the character ID and the name', () => {
    expect(parse(listOf(ROW)).Members.map(({ ID, Name }) => ({ ID, Name }))).toEqual([
      { ID: '12345678', Name: 'Hikari Senshi' },
    ]);
  });

  test.each([
    ['an empty page', '<html><body></body></html>'],
    ['a list with no row', listOf('')],
    ['a row whose name Lodestone has renamed', listOf(ROW.replace('entry__name', 'entry__title'))],
    ['a row whose link has no character ID', listOf(ROW.replace('/lodestone/character/12345678/', '/lodestone/character//'))],
  ])('is a ParseError: %s', (_what, html) => {
    expect(() => parse(html)).toThrow(ParseError);
    expect(() => parse(html)).toThrow(/member row/);
  });
});

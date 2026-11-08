import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { FreeCompanyMembersParser } from '../src/parsers/freecompany-members-parser';
import { FreeCompanyParser } from '../src/parsers/freecompany-parser';

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

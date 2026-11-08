import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { CharacterSearchParser } from '../src/parsers/search-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const parse = (html: string) => new CharacterSearchParser().parse(html);

// A fixture with texts swapped (every copy of each), to try a variation of it. Each text is checked to
// be there, so a change to the fixture cannot turn a test into one that tests nothing.
const variation = (file: string, ...swaps: Array<[from: string, to: string]>) => {
  let page = fixture(file);
  for (const [from, to] of swaps) {
    if (!page.includes(from)) throw new Error(`${file} has no ${from}`);
    page = page.replaceAll(from, to);
  }
  return page;
};

describe('CharacterSearchParser on a search with many matches', () => {
  const html = fixture('search-na.html');
  const pageWith = (...swaps: Array<[from: string, to: string]>) => variation('search-na.html', ...swaps);

  // The avatars of the three rows of the fixture.
  const avatar = (row: number) =>
    `https://img2.finalfantasyxiv.com/f/0000000000000000000000000000000${row}_0000000000000000000000000000000${row}fc0.jpg?170000000${row}`;

  test('parses results with and without a free company', () => {
    const d = parse(html);
    expect(d.Results).toHaveLength(3);
    expect(d.Results[0]).toEqual({
      ID: 12345678,
      Name: 'Aoi Mizuno',
      World: 'Tiamat',
      DC: 'Gaia',
      Avatar: expect.any(String),
      FreeCompany: { ID: '9230000000000000001', Name: 'Moonlit Garden' },
    });
    expect(d.Results[1].FreeCompany).toBeNull();
    expect(d.Pagination).toEqual({ Page: 1, PageTotal: 20, Total: 1000 });
  });

  test('gives each row its own ID, name, world, data center and avatar, in page order', () => {
    expect(parse(html).Results.map(({ ID, Name, World, DC, Avatar }) => ({ ID, Name, World, DC, Avatar }))).toEqual([
      { ID: 12345678, Name: 'Aoi Mizuno', World: 'Tiamat', DC: 'Gaia', Avatar: avatar(1) },
      { ID: 23456789, Name: 'Kaede Aizawa', World: 'Cactuar', DC: 'Aether', Avatar: avatar(2) },
      { ID: 34567890, Name: "A'lu-ne Moku", World: 'Zodiark', DC: 'Light', Avatar: avatar(3) },
    ]);
  });

  test('keeps the free company ID as text, since it is too long for a number', () => {
    const { ID } = parse(html).Results[0].FreeCompany!;

    expect(ID).toBe('9230000000000000001');
    expect(typeof ID).toBe('string');
  });

  test('decodes the entities of a name and keeps its apostrophe and hyphen', () => {
    expect(parse(html).Results[2].Name).toBe("A'lu-ne Moku");
  });

  test('decodes the entities of a free company name and trims it', () => {
    const swapped = pageWith(['<span>Moonlit Garden</span>', '<span>\n  Moonlit &amp; Garden  \n</span>']);

    expect(parse(swapped).Results[0].FreeCompany).toEqual({ ID: '9230000000000000001', Name: 'Moonlit & Garden' });
  });

  describe('the pager and the total', () => {
    // The Japanese site writes "1ページ / 20ページ" and "1000 件" where the English one writes
    // "Page 1 of 20" and "1000 Total": the numbers are read, not the words around them.
    test('are read as numbers, so the Japanese page reads the same as the English one', () => {
      const japanese = pageWith(['Page 1 of 20', '1ページ / 20ページ'], ['1000 Total', '1000 件']);

      expect(parse(japanese).Pagination).toEqual({ Page: 1, PageTotal: 20, Total: 1000 });
    });

    // Lodestone may write a thousands separator in a total, and without it 1,000 would read as 1.
    test.each([
      ['1,000 件', 1000],
      ['1,000 Total', 1000],
      ['1,234,567 Total', 1234567],
      ['512 件', 512],
    ])('a total written as %s is %i', (text, expected) => {
      expect(parse(pageWith(['1000 Total', text])).Pagination.Total).toBe(expected);
    });

    test.each([
      ['Page 20 of 20', { Page: 20, PageTotal: 20 }],
      ['Page 12 of 20', { Page: 12, PageTotal: 20 }],
      ['Page 1 of 1', { Page: 1, PageTotal: 1 }],
    ])('%s is read from the pager of the page', (text, expected) => {
      expect(parse(pageWith(['Page 1 of 20', text])).Pagination).toMatchObject(expected);
    });

    test('are counted from the rows when the page has neither a pager nor a total', () => {
      const bare = html
        .replace(/<ul class="btn__pager">[\s\S]*?<\/ul>/g, '')
        .replace('<div class="parts__total">1000 Total</div>', '');
      if (bare.includes('btn__pager') || bare.includes('parts__total')) {
        throw new Error('search-na.html still has a pager or a total');
      }

      expect(parse(bare).Pagination).toEqual({ Page: 1, PageTotal: 1, Total: 3 });
    });
  });

  describe('a row it cannot make sense of', () => {
    test('is left out when its link has no character ID', () => {
      const swapped = pageWith(['href="/lodestone/character/23456789/"', 'href="/lodestone/character//"']);

      expect(parse(swapped).Results.map(({ ID }) => ID)).toEqual([12345678, 34567890]);
    });

    test('is left out when it has no name', () => {
      const swapped = pageWith(['<p class="entry__name">Kaede Aizawa</p>', '<p class="entry__name">  </p>']);

      expect(parse(swapped).Results.map(({ ID }) => ID)).toEqual([12345678, 34567890]);
    });

    test('is listed with an empty avatar and world when the page gives neither', () => {
      const swapped = pageWith([`<img src="${avatar(2)}" alt="Kaede Aizawa">`, ''], ['Cactuar [Aether]', 'Cactuar']);

      expect(parse(swapped).Results[1]).toEqual({
        ID: 23456789,
        Name: 'Kaede Aizawa',
        World: '',
        DC: '',
        Avatar: '',
        FreeCompany: null,
      });
    });

    test('has no free company when the address of its link has no company ID', () => {
      const swapped = pageWith([
        'href="/lodestone/freecompany/9230000000000000001/"',
        'href="/lodestone/freecompany/"',
      ]);

      expect(parse(swapped).Results[0].FreeCompany).toBeNull();
    });
  });

  describe('a page that is not a search page', () => {
    test('is a ParseError when it has nothing of Lodestone', () => {
      expect(() => parse('<html><body><p>Service unavailable</p></body></html>')).toThrow(ParseError);
      expect(() => parse('')).toThrow(ParseError);
    });

    test('is a ParseError when Lodestone has renamed the window that wraps the page', () => {
      expect(() => parse(pageWith(['ldst__window', 'ldst__frame']))).toThrow(ParseError);
    });
  });

  // A page with the window, but with no row the parser can read and without the notice that nobody
  // matches, is a layout it does not know. Whatever its total says, an empty list would tell every
  // player that nobody has that name.
  describe('a page with no row it can read', () => {
    test.each([
      ['rows', 'class="entry"', 'class="row"'],
      ['links', 'entry__link', 'entry__anchor'],
      ['names', 'entry__name', 'entry__title'],
    ])('is a ParseError, not an empty list, when Lodestone has renamed the %s', (_what, from, to) => {
      const renamed = pageWith([from, to]);

      expect(() => parse(renamed)).toThrow(ParseError);
      expect(() => parse(renamed)).toThrow(/nobody matches/);
    });
  });
});

describe('CharacterSearchParser on a search that finds nobody', () => {
  const NOTICE = '<p class="parts__zero">Your search yielded no results.</p>';
  const TOTAL = '<div class="parts__total">0 Total</div>';
  // Nobody found is always this answer: the first of no pages, with a total of 0.
  const NOBODY = { Results: [], Pagination: { Page: 1, PageTotal: 0, Total: 0 } };

  test('no results', () => {
    expect(parse(fixture('search-none-na.html'))).toEqual(NOBODY);
  });

  test('believes a page that says nobody matches, whatever its total says', () => {
    const page = variation('search-none-na.html', ['0 Total', '1000 Total']);

    expect(parse(page)).toEqual(NOBODY);
  });

  // A total of 0 says it as well as the notice does.
  test('believes a page with a total of 0 and no notice', () => {
    expect(parse(variation('search-none-na.html', [NOTICE, '']))).toEqual(NOBODY);
  });

  test('believes a page with a total of 0 and no notice on the Japanese site, which writes "0 件"', () => {
    expect(parse(variation('search-none-na.html', [NOTICE, ''], ['0 Total', '0 件']))).toEqual(NOBODY);
  });

  // With neither the notice nor a total of 0 the page has changed, and it is a ParseError whether the
  // total says more or is not there at all.
  test.each([
    ['a positive total', [[NOTICE, ''], ['0 Total', '1000 Total']]],
    ['no total at all', [[NOTICE, ''], [TOTAL, '']]],
  ] as Array<[string, Array<[string, string]>]>)(
    'is a ParseError, not an empty list, when the page has no notice that nobody matches and has %s',
    (_what, swaps) => {
      const page = variation('search-none-na.html', ...swaps);

      expect(() => parse(page)).toThrow(ParseError);
      expect(() => parse(page)).toThrow(/nobody matches/);
    },
  );

  test('is a ParseError when the page is only its window', () => {
    expect(() => parse('<html><body><div class="ldst__window"></div></body></html>')).toThrow(ParseError);
  });
});

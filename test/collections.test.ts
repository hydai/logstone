import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { MinionParser } from '../src/parsers/minion-parser';
import { MountParser } from '../src/parsers/mount-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

interface Collection {
  entries: Array<{ Name: string; Icon: string }>;
  total: number;
}

// The mount and the minion page are built the same way and have a parser each, so they share the tests.
// The fixtures are three real rows of the mobile pages (see the comment at the top of each).
const COLLECTIONS = [
  {
    kind: 'mount',
    read: (html: string): Collection => {
      const { Mounts, Total } = new MountParser().parse(html);
      return { entries: Mounts, total: Total };
    },
    pages: [
      { language: 'English', file: 'mount-mobile-na.html', names: ['Company Chocobo', 'Black Chocobo', 'Fat Chocobo'] },
      { language: 'Japanese', file: 'mount-mobile-jp.html', names: ['マイチョコボ', '黒チョコボ', 'でぶチョコボ'] },
    ],
    // The same mounts on both pages, so the same icons.
    icons: [
      'https://lds-img.finalfantasyxiv.com/itemicon/e6/e6cd1b44f2e625546c0a4c4ee9dff3de07b02082.png?n7.57',
      'https://lds-img.finalfantasyxiv.com/itemicon/2e/2e0e69537289e0fece83b6fc1db06c5ad0da2f9c.png?n7.57',
      'https://lds-img.finalfantasyxiv.com/itemicon/dd/ddf98afb1147e510f646b87c7be770261ff07b9d.png?n7.57',
    ],
    // What the names were before: the last part of the tooltip link.
    placeholder: 'Mount-',
  },
  {
    kind: 'minion',
    read: (html: string): Collection => {
      const { Minions, Total } = new MinionParser().parse(html);
      return { entries: Minions, total: Total };
    },
    pages: [
      {
        language: 'English',
        file: 'minion-mobile-na.html',
        names: ['Wayward Hatchling', 'Serpent Hatchling', 'Black Chocobo Chick'],
      },
    ],
    icons: [
      'https://lds-img.finalfantasyxiv.com/itemicon/82/828a8ce3af34af8c5bdb41b1f14f9b7e94435193.png?n7.57',
      'https://lds-img.finalfantasyxiv.com/itemicon/09/094003bfc6d5bb11f0b75fa7eb2c9be4b77fd2f6.png?n7.57',
      'https://lds-img.finalfantasyxiv.com/itemicon/32/32499e159aabfec75ae59adcc60209c047382a42.png?n7.57',
    ],
    placeholder: 'Minion-',
  },
];

for (const { kind, read, pages, icons, placeholder } of COLLECTIONS) {
  describe(`${kind}s on the mobile page`, () => {
    const english = pages[0];
    const html = fixture(english.file);

    // The English page with a text swapped, to try a variation of its first row. The text is checked
    // to be there, so a change to the fixture cannot turn a test into one that tests nothing.
    const pageWith = (from: string, to: string) => {
      if (!html.includes(from)) throw new Error(`${english.file} has no ${from}`);
      return html.replace(from, to);
    };
    const nameOf = (name: string) => `<span class="${kind}__name">${name}</span>`;

    for (const { language, file, names } of pages) {
      test(`reads the ${language} name of each row, in page order`, () => {
        expect(read(fixture(file)).entries.map(({ Name }) => Name)).toEqual(names);
      });

      test(`names nothing after the tooltip link on the ${language} page`, () => {
        const { entries } = read(fixture(file));

        // Without rows there would be no placeholder either, and this would prove nothing.
        expect(entries).toHaveLength(names.length);
        for (const { Name } of entries) {
          expect(Name.startsWith(placeholder)).toBe(false);
        }
      });

      test(`reads the total from the ${language} page`, () => {
        expect(read(fixture(file)).total).toBe(3);
      });
    }

    test('gives each row the image of its own row', () => {
      for (const { file } of pages) {
        expect(read(fixture(file)).entries.map(({ Icon }) => Icon)).toEqual(icons);
      }
    });

    test('takes the total from the page, not from the number of rows', () => {
      expect(read(pageWith('<span>3</span>', '<span>103</span>'))).toMatchObject({ total: 103 });
    });

    test('decodes the entities in a name', () => {
      const [first, second] = english.names;
      const swapped = pageWith(nameOf(first), nameOf('Salt &amp; Pepper Seal')).replace(
        nameOf(second),
        nameOf('Witch&#39;s Broom'),
      );

      expect(read(swapped).entries.map(({ Name }) => Name).slice(0, 2)).toEqual([
        'Salt & Pepper Seal',
        "Witch's Broom",
      ]);
    });

    test('trims the spaces and line breaks around a name', () => {
      const [first] = english.names;

      expect(read(pageWith(nameOf(first), nameOf(`\n    ${first}  \n`))).entries[0].Name).toBe(first);
    });

    test('lists a row only if it has both a name and an image', () => {
      const [, second, third] = english.names;
      const withoutName = pageWith(nameOf(english.names[0]), nameOf(''));
      const withoutImage = pageWith(`<img src="${icons[0]}" `, '<img ');

      expect(read(withoutName).entries.map(({ Name }) => Name)).toEqual([second, third]);
      expect(read(withoutImage).entries.map(({ Name }) => Name)).toEqual([second, third]);
    });

    test('reads a list with no rows as nothing, with a total of 0', () => {
      const empty =
        `<div class="ldst_main_content"><p class="minion__sort__total com">Total: <span>0</span></p>` +
        `<ul class="${kind}__list"></ul></div>`;

      expect(read(empty)).toEqual({ entries: [], total: 0 });
    });

    // Even an empty collection is drawn inside the mobile layout. A page without it is blank, someone
    // else's (a challenge or an error page), or the desktop page Lodestone sends when it ignores the
    // User-Agent: answering it would keep an empty collection in KV for two days.
    test.each([
      ['a blank page', '<html><body></body></html>'],
      ['the desktop layout', `<html><body><div class="ldst__window"><ul class="${kind}__list"></ul></div></body></html>`],
      ['a page with a total of 0 outside the mobile layout', '<html><body><p class="minion__sort__total">Total: <span>0</span></p></body></html>'],
    ])('is a ParseError, not an empty list, for %s', (_what, page) => {
      expect(() => read(page)).toThrow(ParseError);
    });

    describe('when the page counts rows', () => {
      // The English page without a single row, which still says there are 3. The page is checked to be
      // what the tests need, so a change to the fixture cannot turn them into tests of nothing.
      const withoutRows = () => {
        const stripped = html.replace(/<li\b[\s\S]*<\/li>/, '');
        if (stripped.includes('<li') || !stripped.includes('<span>3</span>')) {
          throw new Error(`${english.file} cannot be turned into a page with a total and no rows`);
        }
        return stripped;
      };
      // The English page with every copy of a text swapped: a page whose markup Lodestone has changed.
      const pageWithAll = (from: string, to: string) => {
        if (!html.includes(from)) throw new Error(`${english.file} has no ${from}`);
        return html.replaceAll(from, to);
      };

      test('is a ParseError, not an empty list, when none can be read because the page shows none', () => {
        const page = withoutRows();

        expect(() => read(page)).toThrow(ParseError);
        expect(() => read(page)).toThrow(/3/);
      });

      test.each([
        ['rows', `${kind}__list__item`, `${kind}__list__row`],
        ['names', `${kind}__name`, `${kind}__title`],
        ['images', `${kind}__list__icon__image`, `${kind}__list__picture`],
      ])('is a ParseError when none can be read because Lodestone has renamed the %s', (_what, from, to) => {
        expect(() => read(pageWithAll(from, to))).toThrow(ParseError);
      });

      test('reads the rows it can read when it counts more than that', () => {
        const page = pageWith('<span>3</span>', '<span>103</span>');

        expect(read(page).entries.map(({ Name }) => Name)).toEqual(english.names);
      });

      test.each([
        ['a total of 0', '<span>0</span>'],
        ['a total that is not a number', '<span>--</span>'],
        ['a total with nothing in it', '<span></span>'],
      ])('is an empty list, not an error, when the page shows no rows and has %s', (_what, total) => {
        expect(read(withoutRows().replace('<span>3</span>', total))).toEqual({ entries: [], total: 0 });
      });

      test('is an empty list, not an error, when the page shows no rows and has no total', () => {
        const noTotal = withoutRows().replace(/<p class="minion__sort__total[\s\S]*?<\/p>/, '');
        if (noTotal.includes('<p class="minion__sort__total')) throw new Error(`${english.file} still has a total`);

        expect(read(noTotal)).toEqual({ entries: [], total: 0 });
      });
    });
  });
}

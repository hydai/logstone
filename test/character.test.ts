import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ParseError } from '../src/lib/http';
import { JOB_ICON_KEYS, activeJobKey } from '../src/lib/job-icons';
import { CharacterParser } from '../src/parsers/character-parser';
import { ClassJobParser } from '../src/parsers/classjob-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// The English profile with some of its markup swapped. A swap that finds nothing to replace
// is an error, so a test never passes only because its input did not change.
const profileWith = (...swaps: Array<[from: string, to: string]>) =>
  swaps.reduce((html, [from, to]) => {
    if (!html.includes(from)) throw new Error(`profile-na.html has no ${from}`);
    return html.replace(from, to);
  }, fixture('profile-na.html'));

// The name of the character, where every character page shows it, and nothing else.
const ONLY_THE_NAME =
  '<html><body><div class="frame__chara"><a class="frame__chara__link"><div class="frame__chara__face"></div>' +
  '<div class="frame__chara__box"><p class="frame__chara__name">Hikari Senshi</p></div></a></div></body></html>';

const BIO = '<div class="character__selfintroduction">第一行<br>第二行</div>';
const withBio = (markup: string) =>
  new CharacterParser().parse(profileWith([BIO, `<div class="character__selfintroduction">${markup}</div>`]));

const BARD_ICON = 'https://lds-img.finalfantasyxiv.com/h/F/KWI-9P3RX_Ojjn_mwCS2N0-3TI.png';

describe('CharacterParser on the profile page', () => {
  test('keeps the free company name and names the active job', () => {
    const c = new CharacterParser().parse(fixture('profile-na.html'));
    expect(c.FreeCompany).toEqual({ ID: '9230000000000000001', Name: 'Example Company', Crest: expect.any(Array) });
    expect(c.ActiveClassJob).toEqual({ Key: 'Bard', Level: 100, Icon: expect.stringContaining('KWI-9P3RX_Ojjn_mwCS2N0-3TI.png') });
    expect(c.Bio).toBe('第一行\n第二行');
  });

  test('reads the level on Japanese pages that add the job name', () => {
    expect(new CharacterParser().parse(fixture('profile-jp.html')).ActiveClassJob.Level).toBe(100); // 「LEVEL 100 吟遊詩人」
  });

  test('a character without a free company or title', () => {
    const c = new CharacterParser().parse(fixture('profile-nofc-na.html'));
    expect(c.FreeCompany).toBeNull();
    expect(c.Title).toBeUndefined();
  });

  test('returns the Japanese free company name and bio as written', () => {
    const c = new CharacterParser().parse(fixture('profile-jp.html'));
    expect(c.FreeCompany).toEqual({ ID: '9230000000000000002', Name: 'サンプルカンパニー', Crest: expect.any(Array) });
    expect(c.ActiveClassJob).toEqual({ Key: 'Bard', Level: 100, Icon: BARD_ICON });
    expect(c.Bio).toBe('一行目\n二行目');
  });

  test('the free company name is the text of its link, decoded', () => {
    const c = new CharacterParser().parse(profileWith(['>Example Company</a>', '>Example &amp; Company &lt;3</a>']));
    expect(c.FreeCompany.Name).toBe('Example & Company <3');
  });

  // A bundled JSON file also exports itself as "default". Read as a field of its own, the last selector file
  // would answer its fields a second time, under "Default".
  test('has no field made from the default export of a selector file', () => {
    const c = new CharacterParser().parse(fixture('profile-na.html'));
    expect(c).not.toHaveProperty('Default');
    expect(c.Strength).toBe('400'); // the attributes themselves are still there, once
  });

  test('a page that shows nothing of the character but the name has no company and no active job', () => {
    const c = new CharacterParser().parse(ONLY_THE_NAME);
    expect(c.Name).toBe('Hikari Senshi');
    expect(c.FreeCompany).toBeNull();
    expect(c.ActiveClassJob).toEqual({ Key: null, Level: null, Icon: null });
    expect(c.Bio).toBeUndefined();
  });
});

// Every character page shows the name, the private ones too. A page without one is a layout the parser
// does not know, or another page altogether: a character without a name would be kept for a day.
describe('a page without the character name', () => {
  const NAME = '<p class="frame__chara__name">Hikari Senshi</p>';

  test.each([
    ['an empty page', '<html><body></body></html>'],
    ['only the window of a Lodestone page', '<html><body><div class="ldst__window"></div></body></html>'],
    ['the profile without the name', profileWith([NAME, ''])],
    ['the profile with an empty name', profileWith([NAME, '<p class="frame__chara__name"> </p>'])],
    ['the profile with the name element renamed', profileWith([NAME, '<p class="frame__chara__title">Hikari Senshi</p>'])],
  ])('is a ParseError: %s', (_what, html) => {
    expect(() => new CharacterParser().parse(html)).toThrow(ParseError);
    expect(() => new CharacterParser().parse(html)).toThrow(/character name/);
  });
});

describe('the active job', () => {
  test('keeps the icon and the level in the fields the website already reads', () => {
    const c = new CharacterParser().parse(fixture('profile-na.html'));
    expect(c.ActiveClassjob).toBe(BARD_ICON);
    expect(c.ActiveClassjobLevel).toEqual({ Level: '100' });
  });

  test('takes the level from the first number of the line, with or without the job name after it', () => {
    const level = (line: string) =>
      new CharacterParser().parse(profileWith(['<p>LEVEL 100 </p>', `<p>${line}</p>`])).ActiveClassJob.Level;
    expect(level('LEVEL 7')).toBe(7);
    expect(level('LEVEL 90 Dancer')).toBe(90);
    expect(level('LEVEL 100 吟遊詩人')).toBe(100);
    expect(level('LEVEL 100 / 50')).toBe(100);
  });

  test('has no level when the line shows none', () => {
    const level = (line: string) =>
      new CharacterParser().parse(profileWith(['<p>LEVEL 100 </p>', `<p>${line}</p>`])).ActiveClassJob.Level;
    expect(level('LEVEL --')).toBeNull();
    expect(level('')).toBeNull();
  });

  test('has no key but still the icon and the level when the icon is not in the table', () => {
    const unknown = 'https://lds-img.finalfantasyxiv.com/h/F/some-new-icon.png';
    const c = new CharacterParser().parse(profileWith([BARD_ICON, unknown]));
    expect(c.ActiveClassJob).toEqual({ Key: null, Level: 100, Icon: unknown });
  });
});

describe('the bio', () => {
  test('turns every kind of <br> into a line break', () => {
    expect(withBio('一<br>二<br/>三<br />四').Bio).toBe('一\n二\n三\n四');
  });

  test('keeps a blank line between paragraphs and drops line breaks at either end', () => {
    expect(withBio('<br>一<br><br>二<br>').Bio).toBe('一\n\n二');
  });

  test('reads text inside other elements and decodes entities', () => {
    expect(withBio('Fish &amp; chips<br><span>second <b>line</b></span>').Bio).toBe('Fish & chips\nsecond line');
  });

  test('is the dash the site shows for an empty bio, untouched', () => {
    expect(new CharacterParser().parse(fixture('profile-nofc-na.html')).Bio).toBe('-');
  });

  test('has no Bio when the page has no bio block', () => {
    const c = new CharacterParser().parse(profileWith([BIO, '']));
    expect(c.Bio).toBeUndefined();
  });
});

// The gear tab shows each slot as a box with an icon and its dyes. The name and the item level load later
// from a tooltip, so they are not on the page and not in the answer.
const ITEM_ICON = 'https://lds-img.finalfantasyxiv.com/itemicon/';
const GEAR_ICONS = {
  MainHand: `${ITEM_ICON}10/1000000000000000000000000000000000000000.png?n7.57`,
  Head: `${ITEM_ICON}20/2000000000000000000000000000000000000000.png?n7.57`,
  Body: `${ITEM_ICON}30/3000000000000000000000000000000000000000.png?n7.57`,
  SoulCrystal: `${ITEM_ICON}d0/d000000000000000000000000000000000000000.png?n7.57`,
  Facewear: `${ITEM_ICON}f0/f000000000000000000000000000000000000000.png?n7.57`,
};

// The slots in the order of the answer, each with the class of its box on the page (icon-c--<box>): the
// page numbers the slots from 0 without a 5, and calls the glasses "glasses".
const SLOT_BOXES = [
  ['MainHand', '0'],
  ['OffHand', '1'],
  ['Head', '2'],
  ['Body', '3'],
  ['Hands', '4'],
  ['Legs', '6'],
  ['Feet', '7'],
  ['Earrings', '8'],
  ['Necklace', '9'],
  ['Bracelets', '10'],
  ['Ring1', '11'],
  ['Ring2', '12'],
  ['SoulCrystal', '13'],
  ['Facewear', 'glasses'],
] as const;

const itemIcon = (name: string) => `${ITEM_ICON}${name}.png`;

// A box as the page writes it, with an icon (null for a slot with nothing in it) and the given dye coats.
const gearBox = (box: string, icon: string | null, coatMarkup = '') =>
  `<div class="icon-c--${box} ic_reflection_box js__db_tooltip">` +
  (icon === null
    ? ''
    : `<img src="${icon}" width="40" height="40" alt="" class="character__item_icon__img">` +
      `<div class="character__item_icon character__item_icon--frame"></div>${coatMarkup}`) +
  '</div>';

// One dye coat as the page writes it: painted with a colour, or not painted.
const coat = (color: string | null) =>
  color === null
    ? '<div class="mirage_staining no_paint"></div>'
    : `<div class="mirage_staining painted_cover" style="background-color: ${color};"></div>`;
// The two coats of a slot: the first is a box of its own, the second sits in div.stain2-mirage.
const twoCoats = (first: string, second: string) => `${first}<div class="stain2-mirage">${second}</div>`;

// The name of the character and then the given markup, which is all a page needs to have gear.
const pageWith = (...markup: string[]) => ONLY_THE_NAME.replace('</body>', `${markup.join('')}</body>`);
const gearOf = (html: string) => new CharacterParser().parse(html).Gear;

describe('the gear', () => {
  test('reads each gear slot with its icon and dyes', () => {
    const { Gear } = new CharacterParser().parse(fixture('profile-na.html'));
    expect(Gear).toEqual([
      { Slot: 'MainHand', Icon: GEAR_ICONS.MainHand, Dyes: ['#a1b2c3'] },
      { Slot: 'Head', Icon: GEAR_ICONS.Head, Dyes: [] },
      { Slot: 'Body', Icon: GEAR_ICONS.Body, Dyes: ['#112233', '#445566'] },
      { Slot: 'SoulCrystal', Icon: GEAR_ICONS.SoulCrystal, Dyes: [] },
      { Slot: 'Facewear', Icon: GEAR_ICONS.Facewear, Dyes: [] },
    ]);
  });

  test('names each slot by its box and lists them in the order of the slots, whatever the order of the page', () => {
    // The boxes in reverse, so no slot is in its place by luck, and one icon for each so the right one has to follow it
    const boxes = [...SLOT_BOXES].reverse().map(([slot, box]) => gearBox(box, itemIcon(slot)));
    expect(gearOf(pageWith(...boxes))).toEqual(SLOT_BOXES.map(([slot]) => ({ Slot: slot, Icon: itemIcon(slot), Dyes: [] })));
  });

  test('is an empty list for a page that shows no gear', () => {
    expect(gearOf(ONLY_THE_NAME)).toEqual([]);
    expect(gearOf(fixture('profile-nofc-na.html'))).toEqual([]);
    expect(gearOf(pageWith(...SLOT_BOXES.map(([, box]) => gearBox(box, null))))).toEqual([]);
  });

  describe('a slot without an icon', () => {
    test.each([
      ['has no image', gearBox('2', null)],
      ['has an image without a source', '<div class="icon-c--2 ic_reflection_box"><img src="" class="character__item_icon__img"></div>'],
      ['has an image that is not the item icon', `<div class="icon-c--2 ic_reflection_box"><img src="${GEAR_ICONS.Head}"></div>`],
    ])('is not listed: it %s', (_what, box) => {
      expect(gearOf(pageWith(gearBox('3', GEAR_ICONS.Body), box))).toEqual([{ Slot: 'Body', Icon: GEAR_ICONS.Body, Dyes: [] }]);
    });
  });

  describe('the dyes', () => {
    const dyesOf = (coatMarkup: string) => gearOf(pageWith(gearBox('3', GEAR_ICONS.Body, coatMarkup)))[0].Dyes;

    test('are the painted coats only, the first coat and then the second', () => {
      expect(dyesOf(twoCoats(coat('#112233'), coat('#445566')))).toEqual(['#112233', '#445566']);
      expect(dyesOf(twoCoats(coat('#112233'), coat(null)))).toEqual(['#112233']);
      expect(dyesOf(twoCoats(coat(null), coat('#445566')))).toEqual(['#445566']);
      expect(dyesOf(twoCoats(coat(null), coat(null)))).toEqual([]);
    });

    test('are none for a slot that cannot be dyed or shows no coat at all', () => {
      expect(dyesOf('<div class="mirage_staining unpaitable"></div>')).toEqual([]);
      expect(dyesOf('')).toEqual([]);
    });

    test('are written in lower case, as #rrggbb', () => {
      expect(dyesOf(twoCoats(coat('#A1B2C3'), coat('#0F0F0F')))).toEqual(['#a1b2c3', '#0f0f0f']);
    });

    test.each([
      ['no style', '<div class="mirage_staining painted_cover"></div>'],
      ['a style without a colour', '<div class="mirage_staining painted_cover" style="width: 8px;"></div>'],
      ['a colour that is not #rrggbb', coat('rgb(1, 2, 3)')],
      ['a short colour', coat('#abc')],
    ])('leave out a painted coat with %s', (_what, unreadable) => {
      expect(dyesOf(twoCoats(unreadable, coat('#445566')))).toEqual(['#445566']);
    });

    // Only painted_cover means paint: a coat in any other state gives no dye, even if its style names a colour.
    test.each(['no_paint', 'unpaitable'])('leave out a %s coat even when its style names a colour', (state) => {
      const styled = `<div class="mirage_staining ${state}" style="background-color: #aabbcc;"></div>`;
      expect(dyesOf(twoCoats(styled, coat('#445566')))).toEqual(['#445566']);
      expect(dyesOf(twoCoats(coat('#112233'), styled))).toEqual(['#112233']);
      expect(dyesOf(twoCoats(styled, styled))).toEqual([]);
    });
  });

  test('lists a slot once, from its first box, when the page has the box twice', () => {
    const html = pageWith(gearBox('3', GEAR_ICONS.Body, coat('#112233')), gearBox('3', GEAR_ICONS.Head, coat('#445566')));
    expect(gearOf(html)).toEqual([{ Slot: 'Body', Icon: GEAR_ICONS.Body, Dyes: ['#112233'] }]);
  });

  test('does not read a box that is not one of the slots', () => {
    const html = pageWith(
      gearBox('5', GEAR_ICONS.Head), // the belt, which the game no longer has
      gearBox('14', GEAR_ICONS.Head), // a slot the parser does not know
      gearBox('title', GEAR_ICONS.Head),
      '<i class="icon-c--title icon-c__attributes"></i>', // the icon next to a heading
      `<div class="icon-c--2"><img src="${GEAR_ICONS.Head}" class="character__item_icon__img"></div>`, // not a reflection box
      gearBox('3', GEAR_ICONS.Body)
    );
    expect(gearOf(html)).toEqual([{ Slot: 'Body', Icon: GEAR_ICONS.Body, Dyes: [] }]);
  });

  // The page used to carry the tooltip of each slot inline, which gearset.json read as Mainhand, Offhand
  // and the like. That markup is back here, to show that nothing reads it any more.
  test('no longer returns the gearset fields', () => {
    const tooltip =
      '<div class="db-tooltip"><div><div><div><div><div></div><div><h2></h2><h2>Fake Sword</h2></div></div></div></div></div></div>';
    const mainHand = '<div class="mirage_staining painted_cover" style="background-color: #a1b2c3;"></div>';
    const c = new CharacterParser().parse(profileWith([mainHand, mainHand + tooltip]));

    const gearset = ['MAINHAND', 'OFFHAND', 'HEAD', 'BODY', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'EARRINGS', 'NECKLACE', 'BRACELETS', 'RING1', 'RING2', 'SOULCRYSTAL'];
    for (const key of gearset) {
      expect(c).not.toHaveProperty(key);
      expect(c).not.toHaveProperty(key.charAt(0) + key.slice(1).toLowerCase()); // Mainhand, Soulcrystal ...
    }
    expect(c.Gear[0]).toEqual({ Slot: 'MainHand', Icon: GEAR_ICONS.MainHand, Dyes: ['#a1b2c3'] });
  });
});

describe('activeJobKey', () => {
  test('an icon that is not in the table has no key', () => {
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/x/unknown.png')).toBeNull();
  });

  test('finds the job by the file name of its icon', () => {
    expect(activeJobKey(BARD_ICON)).toBe('Bard');
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/A3UhbjZvDeN3tf_6nJ85VP0RY0.png')).toBe('Warrior');
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/kLob-U-yh652LQPX1NHpLlUYQY.png')).toBe('Pictomancer');
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/OFfyg3oiCvw6DQmECas-wZv01A.png')).toBe('Beastmaster');
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/B4Azydbn7Prubxt7OL9p1LZXZ0.png')).toBe('Fisher');
  });

  test('knows the base classes, which are what a character shows before it has the job', () => {
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/ZpqEJWYHj9SvHGuV9cIyRNnIkk.png')).toBe('Archer');
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/F5JzG9RPIKFSogtaKNBk455aYA.png')).toBe('Gladiator');
  });

  test('knows Paladin, apart from Gladiator', () => {
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/y/d0Tx-vhnsMYfYpGe9MvslemEfg.png')).toBe('Paladin');
  });

  test('does not care about the folder in front of the file name or a query or fragment after it', () => {
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/Z/KWI-9P3RX_Ojjn_mwCS2N0-3TI.png')).toBe('Bard');
    expect(activeJobKey(`${BARD_ICON}?1700000000`)).toBe('Bard');
    expect(activeJobKey(`${BARD_ICON}#icon`)).toBe('Bard');
    expect(activeJobKey('/h/F/KWI-9P3RX_Ojjn_mwCS2N0-3TI.png')).toBe('Bard');
    expect(activeJobKey('KWI-9P3RX_Ojjn_mwCS2N0-3TI.png')).toBe('Bard');
  });

  test('has no key without an icon', () => {
    expect(activeJobKey(null)).toBeNull();
    expect(activeJobKey(undefined)).toBeNull();
    expect(activeJobKey('')).toBeNull();
  });

  test('does not take the name of something every object has for a job', () => {
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/x/constructor')).toBeNull();
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/x/toString')).toBeNull();
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/x/__proto__')).toBeNull();
    expect(activeJobKey('https://lds-img.finalfantasyxiv.com/h/x/hasOwnProperty')).toBeNull();
  });

  test('has a key for every job the Class/Job page lists, named as /classjob names it', () => {
    const jobs = new ClassJobParser().parse(fixture('classjob-na.html'));
    const listed = [
      ...Object.values(jobs.CombatJobs).flatMap((role) => Object.keys(role)),
      ...Object.keys(jobs.CraftingJobs),
      ...Object.keys(jobs.GatheringJobs),
    ];
    expect(listed).toContain('Paladin');
    expect(listed.length).toBeGreaterThan(30);
    const known = new Set(Object.values(JOB_ICON_KEYS));
    expect(listed.filter((key) => !known.has(key))).toEqual([]);
  });
});

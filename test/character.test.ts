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

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { MOBILE_USER_AGENT } from '../src/lib/http';
import { CharacterParser } from '../src/parsers/character-parser';
import { createEnv, stubFetch, workerRequest } from './helpers/env';

const profileNa = readFileSync(new URL('./fixtures/profile-na.html', import.meta.url), 'utf8');
const classjobNa = readFileSync(new URL('./fixtures/classjob-na.html', import.meta.url), 'utf8');
const mountNa = readFileSync(new URL('./fixtures/mount-mobile-na.html', import.meta.url), 'utf8');
const mountJp = readFileSync(new URL('./fixtures/mount-mobile-jp.html', import.meta.url), 'utf8');
const minionNa = readFileSync(new URL('./fixtures/minion-mobile-na.html', import.meta.url), 'utf8');
const searchNa = readFileSync(new URL('./fixtures/search-na.html', import.meta.url), 'utf8');
const searchNone = readFileSync(new URL('./fixtures/search-none-na.html', import.meta.url), 'utf8');

const HOUR = 60 * 60 * 1000;

const htmlPage = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
const lodestoneStatus = (status: number) => () => new Response('Lodestone says no', { status });

let strayRequests: string[];

beforeEach(() => {
  // The Worker logs its 5xx failures, and Lodestone's refusals as warnings; keep them out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Safety net: a test that forgets to stub Lodestone never reaches the network, and fails.
  // (The Worker turns a failed fetch into a 502, so the failure is reported in afterEach.)
  strayRequests = [];
  stubFetch((url) => {
    strayRequests.push(url);
    throw new Error(`Unexpected request to Lodestone: ${url}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(strayRequests).toEqual([]);
});

type GearItem = { Slot: string; Icon: string; Dyes: string[] };
type CharacterBody = { Character: { ID: number; Name: string; Gear: GearItem[] }; FetchedAt: string };

describe('requests the Worker refuses', () => {
  test('a request with neither Origin nor Referer is Forbidden', async () => {
    const { env } = createEnv();
    const calls = stubFetch(() => htmlPage(profileNa));

    const response = await worker.fetch(new Request('https://worker.test/character/1'), env);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
    expect(calls).toHaveLength(0);
  });

  test('an Origin other than ff14.tw is Forbidden', async () => {
    const { env } = createEnv();
    const request = new Request('https://worker.test/character/1', {
      headers: { Origin: 'https://example.com' },
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
  });

  test('a path the Worker does not know is a plain-text Not Found', async () => {
    const { env } = createEnv();

    const response = await worker.fetch(workerRequest('/nope'), env);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});

// Every endpoint, with a path that reaches it.
const ENDPOINTS = [
  { name: 'character', path: '/character/1' },
  { name: 'classjob', path: '/character/1/classjob' },
  { name: 'achievements', path: '/character/1/achievements' },
  { name: 'minions', path: '/character/1/minions' },
  { name: 'mounts', path: '/character/1/mounts' },
  { name: 'freecompany', path: '/freecompany/1' },
  { name: 'members', path: '/freecompany/1/members' },
];

// The ways Lodestone can fail, and what the Worker tells its caller instead.
const FAILURES = [
  { what: 'answers 404', respond: lodestoneStatus(404), status: 404, error: 'not_found' },
  { what: 'answers 403', respond: lodestoneStatus(403), status: 403, error: 'private' },
  { what: 'answers 503', respond: lodestoneStatus(503), status: 502, error: 'upstream' },
  {
    what: 'does not answer at all',
    respond: () => Promise.reject(new TypeError('Network connection lost')),
    status: 502,
    error: 'upstream',
  },
  {
    // The answer is a 200 whose body breaks half way.
    what: 'loses the connection while sending the page',
    respond: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('Network connection lost'));
          },
        }),
      ),
    status: 502,
    error: 'upstream',
  },
  {
    // A blank page, or a page that is not Lodestone's (a challenge or an error page sent with 200).
    // Answering it would keep a nameless character or an empty list in KV.
    what: 'answers 200 with a blank page',
    respond: () => htmlPage('<html><body></body></html>'),
    status: 502,
    error: 'upstream',
  },
  {
    // A layout no parser knows: the window every desktop Lodestone page has, and nothing else a selector
    // finds but a count of rows. Answering it would keep an empty answer in KV.
    what: 'answers 200 with a page the parser does not know',
    respond: () =>
      htmlPage('<html><body><div class="ldst__window"><p class="minion__sort__total">Total: <span>3</span></p></div></body></html>'),
    status: 502,
    error: 'upstream',
  },
];

describe('failures', () => {
  for (const { name, path } of ENDPOINTS) {
    describe(name, () => {
      test('a data center other than na or jp is a bad request that never reaches Lodestone', async () => {
        const { env, kv } = createEnv();
        const calls = stubFetch(() => htmlPage(profileNa));

        const response = await worker.fetch(workerRequest(`${path}?dc=xx`), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'bad_request' });
        expect(calls).toHaveLength(0);
        expect(kv.size).toBe(0);
      });

      for (const failure of FAILURES) {
        test(`when Lodestone ${failure.what}, the Worker answers ${failure.status} ${failure.error} and caches nothing`, async () => {
          const { env, kv } = createEnv();
          stubFetch(failure.respond);

          const response = await worker.fetch(workerRequest(path), env);

          expect(response.status).toBe(failure.status);
          // The website reads the error from another origin.
          expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
          expect(await response.json()).toEqual({ error: failure.error });
          expect(kv.size).toBe(0);
        });
      }
    });
  }

  test('an error is JSON with the CORS header the website needs to read it', async () => {
    const { env } = createEnv();
    stubFetch(lodestoneStatus(404));

    const response = await worker.fetch(workerRequest('/character/1'), env);

    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
  });

  test('a TypeError from the Worker\'s own code, here a failing KV read, is a 500 internal', async () => {
    const { env } = createEnv();
    vi.spyOn(env.LOGSTONE, 'get').mockRejectedValue(new TypeError('KV is down'));

    const response = await worker.fetch(workerRequest('/character/1'), env);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });

  test('a TypeError thrown by a parser, after Lodestone has answered, is a 500 internal, not a 502', async () => {
    const { env, kv } = createEnv();
    stubFetch(() => htmlPage(profileNa));
    vi.spyOn(CharacterParser.prototype, 'parse').mockImplementation(() => {
      throw new TypeError('parser bug');
    });

    const response = await worker.fetch(workerRequest('/character/1'), env);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
    expect(kv.size).toBe(0);
  });

  // wrangler tail is the only place the Worker's own view of a failure shows up.
  describe('what is logged', () => {
    test('a request that gets no answer is logged once, as what really happened', async () => {
      const { env } = createEnv();
      stubFetch(() => Promise.reject(new TypeError('Network connection lost')));

      await worker.fetch(workerRequest('/character/1'), env);

      expect(console.error).toHaveBeenCalledTimes(1);
      const [label, error] = vi.mocked(console.error).mock.calls[0];
      expect(label).toBe('Error:');
      expect(error).toMatchObject({ name: 'UpstreamError', status: 502 });
      // Not an HTTP status Lodestone never sent.
      expect(error.message).toContain('Network connection lost');
      expect(error.message).not.toContain('responded with HTTP');
    });

    // A private page and Lodestone refusing the Worker itself are the same 403, so every one is logged.
    test('a 403 from Lodestone, answered as private, is a warning with the path of the request', async () => {
      const { env } = createEnv();
      stubFetch(lodestoneStatus(403));

      const response = await worker.fetch(workerRequest('/character/1/achievements'), env);

      expect(response.status).toBe(403);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('/character/1/achievements'));
      expect(console.error).not.toHaveBeenCalled();
    });

    test('a 404 from Lodestone is not logged', async () => {
      const { env } = createEnv();
      stubFetch(lodestoneStatus(404));

      await worker.fetch(workerRequest('/character/1'), env);

      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});

describe('an achievement history that Lodestone answers with another character page', () => {
  test('the character profile is a 502 upstream, not an empty history kept for two days', async () => {
    const { env, kv } = createEnv();
    stubFetch(() => htmlPage(profileNa));

    const response = await worker.fetch(workerRequest('/character/1/achievements'), env);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream' });
    expect(kv.size).toBe(0);
  });
});

// The endpoints that take a page number.
const PAGED = ENDPOINTS.filter(({ name }) => name === 'achievements' || name === 'members');

describe('the page parameter', () => {
  for (const { name, path } of PAGED) {
    describe(name, () => {
      for (const page of ['abc', '0', '-1', '1.5', '', '9'.repeat(30)]) {
        test(`page=${page} is a bad request that never reaches Lodestone or KV`, async () => {
          const { env, kv } = createEnv();
          const calls = stubFetch(() => htmlPage(profileNa));

          const response = await worker.fetch(workerRequest(`${path}?page=${page}`), env);

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ error: 'bad_request' });
          expect(calls).toHaveLength(0);
          expect(kv.size).toBe(0);
        });
      }

      test('page=2 is accepted and asked of Lodestone', async () => {
        const { env } = createEnv();
        const calls = stubFetch(lodestoneStatus(404));

        const response = await worker.fetch(workerRequest(`${path}?page=2`), env);

        // Lodestone's own answer comes back, so the page was not rejected as a bad request.
        expect(response.status).toBe(404);
        expect(calls.map((call) => new URL(call.url).searchParams.get('page'))).toEqual(['2']);
      });
    });
  }
});

describe('FetchedAt and the cache on /character/:id', () => {
  const firstFetch = Date.UTC(2026, 10, 8, 2, 30);

  test('a miss reads the page, stamps FetchedAt with the time of the fetch and saves it under the v2 key', async () => {
    vi.setSystemTime(firstFetch);
    const { env, kv } = createEnv();
    const calls = stubFetch(() => htmlPage(profileNa));

    const response = await worker.fetch(workerRequest('/character/1'), env);
    const body = (await response.json()) as CharacterBody;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache-Status')).toBe('MISS');
    expect(body.Character).toMatchObject({ ID: 1, Name: 'Hikari Senshi' });
    expect(body.FetchedAt).toBe('2026-11-08T02:30:00.000Z');
    expect(calls.map((call) => call.url)).toEqual([
      'https://na.finalfantasyxiv.com/lodestone/character/1',
    ]);
    expect([...kv.keys()]).toEqual(['v2:character:na:1']);
    expect(JSON.parse(kv.get('v2:character:na:1')!).timestamp).toBe(firstFetch);
  });

  test('a hit does not call Lodestone and keeps the time of the first fetch', async () => {
    const { env } = createEnv();
    const calls = stubFetch(() => htmlPage(profileNa));

    vi.setSystemTime(firstFetch);
    const first = await worker.fetch(workerRequest('/character/1'), env);
    const firstBody = (await first.json()) as CharacterBody;

    vi.setSystemTime(firstFetch + 3 * HOUR);
    const second = await worker.fetch(workerRequest('/character/1'), env);
    const secondBody = (await second.json()) as CharacterBody;

    expect(calls).toHaveLength(1);
    expect(second.headers.get('X-Cache-Status')).toBe('HIT');
    expect(secondBody.FetchedAt).toBe('2026-11-08T02:30:00.000Z');
    expect(secondBody).toEqual(firstBody);
  });

  test('the answer carries Character.Gear, from a miss and from a hit', async () => {
    const { env } = createEnv();
    stubFetch(() => htmlPage(profileNa));

    const first = await worker.fetch(workerRequest('/character/1'), env);
    const second = await worker.fetch(workerRequest('/character/1'), env);

    // The slots profile-na.html shows, in the order of the answer (the parser's tests check every icon and dye)
    const gear = [
      { Slot: 'MainHand', Icon: expect.stringMatching(/^https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\//), Dyes: ['#a1b2c3'] },
      { Slot: 'Head', Icon: expect.any(String), Dyes: [] },
      { Slot: 'Body', Icon: expect.any(String), Dyes: ['#112233', '#445566'] },
      { Slot: 'SoulCrystal', Icon: expect.any(String), Dyes: [] },
      { Slot: 'Facewear', Icon: expect.any(String), Dyes: [] },
    ];
    expect(first.headers.get('X-Cache-Status')).toBe('MISS');
    expect(((await first.json()) as CharacterBody).Character.Gear).toEqual(gear);
    expect(second.headers.get('X-Cache-Status')).toBe('HIT');
    expect(((await second.json()) as CharacterBody).Character.Gear).toEqual(gear);
  });

  test('an entry saved before v2 under the old key is not served', async () => {
    vi.setSystemTime(firstFetch);
    const { env, kv } = createEnv();
    kv.set(
      'character:na:1',
      JSON.stringify({ data: { Character: { ID: 1, Name: 'Old Parser' } }, timestamp: firstFetch }),
    );
    const calls = stubFetch(() => htmlPage(profileNa));

    const response = await worker.fetch(workerRequest('/character/1'), env);
    const body = (await response.json()) as CharacterBody;

    expect(calls).toHaveLength(1);
    expect(body.Character.Name).toBe('Hikari Senshi');
  });

  // KV's free plan allows 1,000 writes a day, and put() rejects after that.
  test('a miss whose KV write fails still answers with the data and FetchedAt, and logs the key', async () => {
    vi.setSystemTime(firstFetch);
    const { env, kv } = createEnv();
    vi.spyOn(env.LOGSTONE, 'put').mockRejectedValue(new Error('KV put() limit exceeded for the day.'));
    stubFetch(() => htmlPage(profileNa));

    const response = await worker.fetch(workerRequest('/character/1'), env);
    const body = (await response.json()) as CharacterBody;

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache-Status')).toBe('MISS');
    expect(body.Character).toMatchObject({ ID: 1, Name: 'Hikari Senshi' });
    expect(body.FetchedAt).toBe('2026-11-08T02:30:00.000Z');
    expect(kv.size).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('v2:character:na:1'),
      expect.objectContaining({ message: 'KV put() limit exceeded for the day.' }),
    );
  });
});

// What each endpoint keeps in KV: the key, and how long (in hours) an entry is served.
// Collections change slowly, so they are kept twice as long as the rest.
const CACHED = [
  { path: '/character/1', key: 'v2:character:na:1', ttlHours: 24 },
  { path: '/character/1?dc=jp', key: 'v2:character:jp:1', ttlHours: 24 },
  { path: '/character/1/classjob', key: 'v2:classjob:na:1', ttlHours: 24 },
  { path: '/character/1/classjob?dc=jp', key: 'v2:classjob:jp:1', ttlHours: 24 },
  { path: '/character/1/achievements', key: 'v2:achievements:na:1:page1', ttlHours: 48 },
  { path: '/character/1/achievements?dc=jp&page=2', key: 'v2:achievements:jp:1:page2', ttlHours: 48 },
  { path: '/character/1/minions', key: 'v2:minions:na:1', ttlHours: 48 },
  { path: '/character/1/mounts?dc=jp', key: 'v2:mounts:jp:1', ttlHours: 48 },
  { path: '/freecompany/1', key: 'v2:freecompany:na:1', ttlHours: 24 },
  { path: '/freecompany/1/members', key: 'v2:members:na:1:page1', ttlHours: 24 },
  { path: '/freecompany/1/members?dc=jp&page=3', key: 'v2:members:jp:1:page3', ttlHours: 24 },
];

describe('cache keys and lifetimes', () => {
  const now = Date.UTC(2026, 10, 8, 12);

  beforeEach(() => {
    vi.setSystemTime(now);
  });

  for (const { path, key, ttlHours } of CACHED) {
    describe(path, () => {
      test(`serves an entry younger than ${ttlHours} hours from ${key}, with the time it was saved`, async () => {
        const { env, kv } = createEnv();
        const savedAt = now - (ttlHours - 1) * HOUR;
        kv.set(key, JSON.stringify({ data: { Saved: 'earlier' }, timestamp: savedAt }));
        const calls = stubFetch(lodestoneStatus(503));

        const response = await worker.fetch(workerRequest(path), env);

        expect(calls).toHaveLength(0);
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Cache-Status')).toBe('HIT');
        expect(await response.json()).toEqual({
          Saved: 'earlier',
          FetchedAt: new Date(savedAt).toISOString(),
        });
      });

      test(`asks Lodestone again once the entry is older than ${ttlHours} hours`, async () => {
        const { env, kv } = createEnv();
        kv.set(key, JSON.stringify({ data: { Saved: 'earlier' }, timestamp: now - (ttlHours + 1) * HOUR }));
        const calls = stubFetch(lodestoneStatus(503));

        await worker.fetch(workerRequest(path), env);

        expect(calls).toHaveLength(1);
      });
    });
  }

  // KV drops an entry once it is no longer served, so nothing is left in it for good.
  test.each([
    { path: '/character/1', page: profileNa, key: 'v2:character:na:1', expirationTtl: 86400 },
    // An empty minion list (inside the mobile layout, as Lodestone draws one), kept twice as long as the rest.
    {
      path: '/character/1/minions',
      page: '<html><body><div class="ldst_main_content"><p class="minion__sort__total">Total: <span>0</span></p></div></body></html>',
      key: 'v2:minions:na:1',
      expirationTtl: 172800,
    },
  ])('$path is saved in $key to expire after $expirationTtl seconds, the time it is served', async ({ path, page, key, expirationTtl }) => {
    const { env } = createEnv();
    const put = vi.spyOn(env.LOGSTONE, 'put');
    stubFetch(() => htmlPage(page));

    const response = await worker.fetch(workerRequest(path), env);

    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(key, expect.any(String), { expirationTtl });
  });

  test('an expiry shorter than the 60 seconds KV takes at least is raised to 60', async () => {
    const { env } = createEnv();
    env.CACHE_TTL = '30';
    const put = vi.spyOn(env.LOGSTONE, 'put');
    stubFetch(() => htmlPage(profileNa));

    await worker.fetch(workerRequest('/character/1'), env);

    expect(put).toHaveBeenCalledWith('v2:character:na:1', expect.any(String), { expirationTtl: 60 });
  });
});

// The class job and achievement pages were read from the English site whatever `dc` said.
// Each is asked of the Lodestone site of its own data center and saved under the key of that data center.
// The history of a character with no achievement yet, which is still an answer: the name and a total of 0.
const NO_ACHIEVEMENTS =
  '<html><body><div class="ldst__window"><div class="frame__chara"><a class="frame__chara__link">' +
  '<div class="frame__chara__face"></div><div class="frame__chara__box"><p class="frame__chara__name">Hikari Senshi</p></div>' +
  '</a></div><div class="ldst__achievement"><div class="parts__total">0 Total</div></div></div></body></html>';
const DC_PAGES = [
  {
    path: '/character/1/classjob',
    page: 'https://na.finalfantasyxiv.com/lodestone/character/1/class_job',
    key: 'v2:classjob:na:1',
    body: classjobNa,
  },
  {
    path: '/character/1/classjob?dc=jp',
    page: 'https://jp.finalfantasyxiv.com/lodestone/character/1/class_job',
    key: 'v2:classjob:jp:1',
    body: classjobNa,
  },
  {
    path: '/character/1/achievements',
    page: 'https://na.finalfantasyxiv.com/lodestone/character/1/achievement?page=1',
    key: 'v2:achievements:na:1:page1',
    body: NO_ACHIEVEMENTS,
  },
  {
    path: '/character/1/achievements?dc=jp&page=2',
    page: 'https://jp.finalfantasyxiv.com/lodestone/character/1/achievement?page=2',
    key: 'v2:achievements:jp:1:page2',
    body: NO_ACHIEVEMENTS,
  },
];

describe('the Lodestone site of the data center', () => {
  for (const { path, page, key, body } of DC_PAGES) {
    test(`${path} reads ${page} and saves what it found under ${key}`, async () => {
      const { env, kv } = createEnv();
      const calls = stubFetch(() => htmlPage(body));

      const response = await worker.fetch(workerRequest(path), env);

      expect(response.status).toBe(200);
      expect(calls.map((call) => call.url)).toEqual([page]);
      expect([...kv.keys()]).toEqual([key]);
    });
  }

  test('the class job answer keeps its ClassJobs wrapper and holds the 7.0 jobs and Blue Mage', async () => {
    const { env } = createEnv();
    stubFetch(() => htmlPage(classjobNa));

    const response = await worker.fetch(workerRequest('/character/1/classjob?dc=jp'), env);
    const body = (await response.json()) as {
      CharacterID: number;
      ClassJobs: { CombatJobs: Record<'MeleeDPS' | 'MagicalDPS', Record<string, { Level: string }>> };
    };

    expect(body.CharacterID).toBe(1);
    expect(body.ClassJobs.CombatJobs.MeleeDPS.Viper.Level).toBe('80');
    expect(body.ClassJobs.CombatJobs.MeleeDPS.Beastmaster.Level).toBe('50');
    expect(body.ClassJobs.CombatJobs.MagicalDPS.Pictomancer.Level).toBe('91');
    expect(body.ClassJobs.CombatJobs.MagicalDPS.BlueMage.Level).toBe('50');
  });
});

// Lodestone writes the name of every mount and minion only on its mobile layout, and picks the
// layout by User-Agent. The other endpoints read the desktop layout.
const MOBILE_ENDPOINTS = ['mounts', 'minions'];
const MOBILE_PAGES = [
  { path: '/character/1/mounts', page: 'https://na.finalfantasyxiv.com/lodestone/character/1/mount', body: mountNa },
  { path: '/character/1/mounts?dc=jp', page: 'https://jp.finalfantasyxiv.com/lodestone/character/1/mount', body: mountJp },
  { path: '/character/1/minions', page: 'https://na.finalfantasyxiv.com/lodestone/character/1/minion', body: minionNa },
];

const userAgentOf = (call: { init?: RequestInit }) => new Headers(call.init?.headers).get('User-Agent');
const LODESTONE_ICON = /^https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\/[0-9a-f]{2}\/[0-9a-f]{40}\.png/;

describe('the mount and minion pages', () => {
  test('the mobile User-Agent is the iPhone one the pages were captured with', () => {
    expect(MOBILE_USER_AGENT).toBe(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    );
  });

  for (const { path, page, body } of MOBILE_PAGES) {
    test(`${path} reads ${page} with the mobile User-Agent`, async () => {
      const { env } = createEnv();
      const calls = stubFetch(() => htmlPage(body));

      await worker.fetch(workerRequest(path), env);

      expect(calls.map((call) => call.url)).toEqual([page]);
      expect(userAgentOf(calls[0])).toBe(MOBILE_USER_AGENT);
    });
  }

  for (const { path } of ENDPOINTS.filter(({ name }) => !MOBILE_ENDPOINTS.includes(name))) {
    test(`${path} is still read without the mobile User-Agent`, async () => {
      const { env } = createEnv();
      const calls = stubFetch(() => htmlPage('<html><body></body></html>'));

      await worker.fetch(workerRequest(path), env);

      expect(calls).toHaveLength(1);
      expect(userAgentOf(calls[0])).not.toBe(MOBILE_USER_AGENT);
    });
  }

  test('/mounts answers with the name and icon of every mount', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 8, 2, 30));
    const { env } = createEnv();
    stubFetch(() => htmlPage(mountNa));

    const response = await worker.fetch(workerRequest('/character/1/mounts'), env);
    const body = (await response.json()) as {
      CharacterID: number;
      Mounts: Array<{ Name: string; Icon: string }>;
      Total: number;
      FetchedAt: string;
    };

    expect(response.status).toBe(200);
    expect(body.CharacterID).toBe(1);
    expect(body.Mounts.map(({ Name }) => Name)).toEqual(['Company Chocobo', 'Black Chocobo', 'Fat Chocobo']);
    for (const { Icon } of body.Mounts) {
      expect(Icon).toMatch(LODESTONE_ICON);
    }
    expect(body.Total).toBe(3);
    expect(body.FetchedAt).toBe('2026-11-08T02:30:00.000Z');
  });

  test('/mounts?dc=jp answers with the Japanese names as Lodestone writes them', async () => {
    const { env } = createEnv();
    stubFetch(() => htmlPage(mountJp));

    const response = await worker.fetch(workerRequest('/character/1/mounts?dc=jp'), env);
    const body = (await response.json()) as { Mounts: Array<{ Name: string }> };

    expect(body.Mounts.map(({ Name }) => Name)).toEqual(['マイチョコボ', '黒チョコボ', 'でぶチョコボ']);
  });

  test('/minions answers with the name and icon of every minion', async () => {
    const { env } = createEnv();
    stubFetch(() => htmlPage(minionNa));

    const response = await worker.fetch(workerRequest('/character/1/minions'), env);
    const body = (await response.json()) as {
      CharacterID: number;
      Minions: Array<{ Name: string; Icon: string }>;
      Total: number;
    };

    expect(response.status).toBe(200);
    expect(body.CharacterID).toBe(1);
    expect(body.Minions.map(({ Name }) => Name)).toEqual([
      'Wayward Hatchling',
      'Serpent Hatchling',
      'Black Chocobo Chick',
    ]);
    for (const { Icon } of body.Minions) {
      expect(Icon).toMatch(LODESTONE_ICON);
    }
    expect(body.Total).toBe(3);
  });

  // A page that counts rows but shows none the parser can read is a layout the Worker does not know,
  // not an empty collection: answering [] would keep that in KV as the truth. A collection that
  // really is empty says 0, and that is an answer like any other.
  const withoutRows = (html: string) => html.replace(/<li\b[\s\S]*<\/li>/, '');
  const COUNTED = [
    { path: '/character/1/mounts', key: 'v2:mounts:na:1', list: 'Mounts', page: mountNa },
    { path: '/character/1/minions', key: 'v2:minions:na:1', list: 'Minions', page: minionNa },
  ];

  for (const { path, key, list, page } of COUNTED) {
    test(`${path} with a total but no rows is a 502 upstream and caches nothing`, async () => {
      const { env, kv } = createEnv();
      stubFetch(() => htmlPage(withoutRows(page)));

      const response = await worker.fetch(workerRequest(path), env);

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'upstream' });
      expect(kv.size).toBe(0);
    });

    test(`${path} with a total of 0 and no rows is an empty collection, cached like any other`, async () => {
      vi.setSystemTime(Date.UTC(2026, 10, 8, 2, 30));
      const { env, kv } = createEnv();
      stubFetch(() => htmlPage(withoutRows(page).replace('<span>3</span>', '<span>0</span>')));

      const response = await worker.fetch(workerRequest(path), env);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        CharacterID: 1,
        [list]: [],
        Total: 0,
        FetchedAt: '2026-11-08T02:30:00.000Z',
      });
      expect([...kv.keys()]).toEqual([key]);
    });
  }
});

// Searching for a character is unlike the other endpoints: it takes a name instead of an ID, and its
// answer is never kept, in KV or anywhere else (searches are too frequent for the writes the free
// plan of KV allows). It reads the desktop layout of the search page.
describe('GET /search/character', () => {
  const search = (query: string) => workerRequest(`/search/character?${query}`);

  // The Lodestone URL the Worker asks for a search, which Lodestone answers with the page of nobody found.
  const lodestoneUrlFor = async (query: string): Promise<URL> => {
    const { env } = createEnv();
    const calls = stubFetch(() => htmlPage(searchNone));

    const response = await worker.fetch(search(query), env);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    return new URL(calls[0].url);
  };

  describe('a request that is wrong never reaches Lodestone or KV', () => {
    const WRONG = [
      ['no name', 'world=Tiamat'],
      ['an empty name', 'name='],
      ['a blank name', 'name=%20%20%20'],
      ['a name of 41 characters', `name=${'a'.repeat(41)}`],
      ['41 characters that take two UTF-16 units each', `name=${encodeURIComponent('😀'.repeat(41))}`],
      ['page 0', 'name=Aoi&page=0'],
      ['page 21', 'name=Aoi&page=21'],
      ['page abc', 'name=Aoi&page=abc'],
      ['page 1.5', 'name=Aoi&page=1.5'],
      ['an empty page', 'name=Aoi&page='],
      ['a world with a space', 'name=Aoi&world=Tia%20mat'],
      ['a world with a digit', 'name=Aoi&world=Tiamat2'],
      ['a world with a hyphen', 'name=Aoi&world=Tia-mat'],
      ['a data center prefix and no data center after it', 'name=Aoi&world=_dc_'],
      ['a world that carries another parameter', 'name=Aoi&world=Tiamat%26page%3D9'],
      ['a world in Japanese', `name=Aoi&world=${encodeURIComponent('ティアマット')}`],
      ['an unknown data center', 'name=Aoi&dc=xx'],
      // A filter under another name must not quietly become a search of every world.
      ["Lodestone's own worldname instead of world", 'name=Aoi&worldname=Tiamat'],
      ['a misspelled world', 'name=Aoi&wrold=Tiamat'],
      ['a parameter the search does not take', 'name=Aoi&world=Tiamat&foo=1'],
    ];

    for (const [what, query] of WRONG) {
      test(`${what} is a 400 bad_request`, async () => {
        const { env, kv } = createEnv();
        const calls = stubFetch(() => htmlPage(searchNa));

        const response = await worker.fetch(search(query), env);

        expect(response.status).toBe(400);
        // The website reads the error from another origin.
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
        expect(await response.json()).toEqual({ error: 'bad_request' });
        expect(calls).toHaveLength(0);
        expect(kv.size).toBe(0);
      });
    }
  });

  describe('what it asks of Lodestone', () => {
    test('is the search page of the data center, with the name, the world and the page', async () => {
      const url = await lodestoneUrlFor("name=Y'shtola%20Rhul&world=_dc_Elemental&dc=jp&page=2");

      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('jp.finalfantasyxiv.com');
      expect(url.pathname).toBe('/lodestone/character/');
      expect(url.searchParams.get('q')).toBe("Y'shtola Rhul");
      expect(url.searchParams.get('worldname')).toBe('_dc_Elemental');
      expect(url.searchParams.get('page')).toBe('2');
    });

    test.each(['', 'world='])('is the na site, all worlds and the first page when the query is only a name and %j', async (extra) => {
      const url = await lodestoneUrlFor(`name=Aoi&${extra}`);

      expect(url.hostname).toBe('na.finalfantasyxiv.com');
      expect(url.searchParams.get('q')).toBe('Aoi');
      // All worlds is a worldname that is there and empty, as the search form of Lodestone sends it.
      expect(url.searchParams.has('worldname')).toBe(true);
      expect(url.searchParams.get('worldname')).toBe('');
      expect(url.searchParams.get('page')).toBe('1');
    });

    test.each(['_dc_Elemental', 'Tiamat'])('takes %s as a world to search in', async (world) => {
      expect((await lodestoneUrlFor(`name=Aoi&world=${world}`)).searchParams.get('worldname')).toBe(world);
    });

    test('goes as far as page 20, the last page Lodestone shows', async () => {
      expect((await lodestoneUrlFor('name=Aoi&page=20')).searchParams.get('page')).toBe('20');
    });

    // A name goes to Lodestone as it was typed, whatever it holds, so q decodes to what the player wrote.
    test.each(["Y'shtola Rhul", "A'lu-ne Moku", 'ティアマット', 'Aoi & Aoi=1', '100% Real', 'a+b'])(
      'sends the name %s exactly as it was typed',
      async (name) => {
        expect((await lodestoneUrlFor(`name=${encodeURIComponent(name)}`)).searchParams.get('q')).toBe(name);
      },
    );

    test('leaves out the spaces around a name', async () => {
      const url = await lodestoneUrlFor(`name=${encodeURIComponent('  Aoi Mizuno \t')}`);

      expect(url.searchParams.get('q')).toBe('Aoi Mizuno');
    });

    test('accepts a name of 40 characters, however many UTF-16 units they take', async () => {
      for (const name of ['a'.repeat(40), '😀'.repeat(40)]) {
        expect((await lodestoneUrlFor(`name=${encodeURIComponent(name)}`)).searchParams.get('q')).toBe(name);
      }
    });

    test('is the desktop layout: there is no mobile User-Agent', async () => {
      const { env } = createEnv();
      const calls = stubFetch(() => htmlPage(searchNone));

      await worker.fetch(search('name=Aoi'), env);

      expect(userAgentOf(calls[0])).not.toBe(MOBILE_USER_AGENT);
    });
  });

  describe('the answer', () => {
    test('has the results, the pagination and the time of the fetch', async () => {
      vi.setSystemTime(Date.UTC(2026, 10, 8, 2, 30));
      const { env } = createEnv();
      stubFetch(() => htmlPage(searchNa));

      const response = await worker.fetch(search('name=Aoi'), env);
      const body = (await response.json()) as {
        Results: Array<{ Name: string; FreeCompany: { ID: string; Name: string } | null }>;
        Pagination: object;
        FetchedAt: string;
      };

      expect(response.status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(['FetchedAt', 'Pagination', 'Results']);
      expect(body.Results.map(({ Name }) => Name)).toEqual(['Aoi Mizuno', 'Kaede Aizawa', "A'lu-ne Moku"]);
      expect(body.Results.map(({ FreeCompany }) => FreeCompany)).toEqual([
        { ID: '9230000000000000001', Name: 'Moonlit Garden' },
        null,
        null,
      ]);
      expect(body.Pagination).toEqual({ Page: 1, PageTotal: 20, Total: 1000 });
      expect(body.FetchedAt).toBe('2026-11-08T02:30:00.000Z');
    });

    test('is an empty list, not an error, when nobody matches', async () => {
      vi.setSystemTime(Date.UTC(2026, 10, 8, 2, 30));
      const { env } = createEnv();
      stubFetch(() => htmlPage(searchNone));

      const response = await worker.fetch(search('name=Nobody%20Atall'), env);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        Results: [],
        Pagination: { Page: 1, PageTotal: 0, Total: 0 },
        FetchedAt: '2026-11-08T02:30:00.000Z',
      });
    });

    test('is JSON with the CORS header the website needs, and has no cache status since nothing is cached', async () => {
      const { env } = createEnv();
      stubFetch(() => htmlPage(searchNa));

      const response = await worker.fetch(search('name=Aoi'), env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
      expect(response.headers.get('X-Cache-Status')).toBeNull();
    });

    test('is never kept in KV, which is not even read', async () => {
      const { env, kv } = createEnv();
      const read = vi.spyOn(env.LOGSTONE, 'get');
      const write = vi.spyOn(env.LOGSTONE, 'put');
      stubFetch(() => htmlPage(searchNa));

      const response = await worker.fetch(search('name=Aoi'), env);

      // The search did run, so there was something to keep.
      expect(response.status).toBe(200);
      expect(kv.size).toBe(0);
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    test('is not kept anywhere else either: the same search asks Lodestone again', async () => {
      const { env } = createEnv();
      let asked = 0;
      stubFetch(() => htmlPage(asked++ === 0 ? searchNa : searchNone));

      const first = (await (await worker.fetch(search('name=Aoi'), env)).json()) as { Results: unknown[] };
      const second = (await (await worker.fetch(search('name=Aoi'), env)).json()) as { Results: unknown[] };

      expect(asked).toBe(2);
      expect(first.Results).toHaveLength(3);
      expect(second.Results).toHaveLength(0);
    });
  });

  // Every failure is read by the website from another origin, so each one carries the CORS header.
  describe('when it goes wrong at Lodestone', () => {
    test('a 200 page that is not a search page is a 502 upstream, and keeps nothing', async () => {
      const { env, kv } = createEnv();
      stubFetch(() => htmlPage('<html><body><p>Service unavailable</p></body></html>'));

      const response = await worker.fetch(search('name=Aoi'), env);

      expect(response.status).toBe(502);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
      expect(await response.json()).toEqual({ error: 'upstream' });
      expect(kv.size).toBe(0);
    });

    // Lodestone answers a search with a 200 page even when nobody matches, and the page says so. So a 404 or
    // a 403 for the search URL is Lodestone failing, not the "no such character" or "private" of the other
    // endpoints: it is a 502 like any other failure, and it is logged like one, with the status Lodestone sent.
    test.each([404, 403])(
      'when Lodestone answers the search with %i, the Worker answers 502 upstream, logs it and keeps nothing',
      async (status) => {
        const { env, kv } = createEnv();
        stubFetch(lodestoneStatus(status));

        const response = await worker.fetch(search('name=Aoi'), env);

        expect(response.status).toBe(502);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
        expect(await response.json()).toEqual({ error: 'upstream' });
        expect(kv.size).toBe(0);
        expect(console.error).toHaveBeenCalledWith(
          'Error:',
          expect.objectContaining({ name: 'UpstreamError', status: 502, message: expect.stringContaining(String(status)) }),
        );
      },
    );

    // A page that has the window but neither a row the parser can read, nor the notice that nobody matches,
    // nor a total of 0, is a page Lodestone has changed: it is not a search that found nobody.
    test.each([
      ['only the window', '<html><body><div class="ldst__window"></div></body></html>'],
      ['a total but no row it can read', searchNa.replaceAll('entry__link', 'entry__anchor')],
    ])('a page with %s is a 502 upstream, not an empty list, and keeps nothing', async (_what, page) => {
      const { env, kv } = createEnv();
      stubFetch(() => htmlPage(page));

      const response = await worker.fetch(search('name=Aoi'), env);

      expect(response.status).toBe(502);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
      expect(await response.json()).toEqual({ error: 'upstream' });
      expect(kv.size).toBe(0);
    });

    for (const failure of FAILURES.filter(({ status }) => status === 502)) {
      test(`when Lodestone ${failure.what}, the Worker answers 502 upstream`, async () => {
        const { env, kv } = createEnv();
        stubFetch(failure.respond);

        const response = await worker.fetch(search('name=Aoi'), env);

        expect(response.status).toBe(502);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ff14.tw');
        expect(await response.json()).toEqual({ error: 'upstream' });
        expect(kv.size).toBe(0);
      });
    }
  });
});

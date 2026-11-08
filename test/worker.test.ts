import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index';
import { CharacterParser } from '../src/parsers/character-parser';
import { createEnv, stubFetch, workerRequest } from './helpers/env';

const profileNa = readFileSync(new URL('./fixtures/profile-na.html', import.meta.url), 'utf8');
const classjobNa = readFileSync(new URL('./fixtures/classjob-na.html', import.meta.url), 'utf8');

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

type CharacterBody = { Character: { ID: number; Name: string }; FetchedAt: string };

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
    // An empty minion list, kept twice as long as the rest.
    { path: '/character/1/minions', page: '<html><body></body></html>', key: 'v2:minions:na:1', expirationTtl: 172800 },
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
const NO_ACHIEVEMENTS = '<html><body></body></html>';
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

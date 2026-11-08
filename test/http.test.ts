import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  BadRequestError,
  CACHE_VERSION,
  ParseError,
  UpstreamError,
  cacheKey,
  errorStatus,
  fetchUpstreamText,
  parseDc,
  parsePage,
  withFetchedAt,
} from '../src/lib/http';
import { stubFetch } from './helpers/env';

describe('errorStatus', () => {
  test('maps every failure to one status and code', () => {
    expect(errorStatus(new BadRequestError('x'))).toEqual({ status: 400, code: 'bad_request' });
    expect(errorStatus(new UpstreamError(404))).toEqual({ status: 404, code: 'not_found' });
    expect(errorStatus(new UpstreamError(403))).toEqual({ status: 403, code: 'private' });
    expect(errorStatus(new UpstreamError(503))).toEqual({ status: 502, code: 'upstream' });
    expect(errorStatus(new ParseError('x'))).toEqual({ status: 502, code: 'upstream' });
    expect(errorStatus(new TypeError('x'))).toEqual({ status: 500, code: 'internal' });
  });

  test('treats every other Lodestone status as a failed upstream, not as our own error', () => {
    for (const status of [400, 401, 410, 429, 500, 502, 504]) {
      expect(errorStatus(new UpstreamError(status))).toEqual({ status: 502, code: 'upstream' });
    }
  });

  test('treats anything that is not one of our errors as internal', () => {
    expect(errorStatus(new Error('boom'))).toEqual({ status: 500, code: 'internal' });
    expect(errorStatus('boom')).toEqual({ status: 500, code: 'internal' });
    expect(errorStatus(undefined)).toEqual({ status: 500, code: 'internal' });
  });

  test('UpstreamError keeps the status it was made with', () => {
    const error = new UpstreamError(503);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(503);
  });

  test('UpstreamError says which status Lodestone answered with, unless it is told what happened', () => {
    expect(new UpstreamError(503).message).toBe('Lodestone responded with HTTP 503');

    const error = new UpstreamError(502, 'Request to Lodestone failed');
    expect(error.status).toBe(502);
    expect(error.message).toBe('Request to Lodestone failed');
  });
});

describe('fetchUpstreamText', () => {
  const url = 'https://na.finalfantasyxiv.com/lodestone/character/1';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the text of an ok response, and passes the url and init on to fetch', async () => {
    const init = { headers: { 'User-Agent': 'Test agent' } };
    const calls = stubFetch(() => new Response('the page'));

    expect(await fetchUpstreamText(url, init)).toBe('the page');
    expect(calls).toEqual([{ url, init }]);
  });

  for (const status of [404, 403, 503]) {
    test(`turns HTTP ${status} into an UpstreamError with that status`, async () => {
      stubFetch(() => new Response('no', { status }));

      const error = await fetchUpstreamText(url).catch((caught) => caught);

      expect(error).toBeInstanceOf(UpstreamError);
      expect(error.status).toBe(status);
    });
  }

  // The Worker logs a failure once, where it answers it, so the error itself has to say what happened.
  test('turns a fetch that gets no answer into a 502 UpstreamError that says what went wrong, without logging it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => Promise.reject(new TypeError('Network connection lost')));

    const error = await fetchUpstreamText(url).catch((caught) => caught);

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.status).toBe(502);
    expect(error.message).toContain(url);
    expect(error.message).toContain('TypeError: Network connection lost');
    expect(log).not.toHaveBeenCalled();
  });

  test('turns a connection lost while the body is coming in into a 502 UpstreamError that says so, without logging it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('Network connection lost'));
            },
          }),
        ),
    );

    const error = await fetchUpstreamText(url).catch((caught) => caught);

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.status).toBe(502);
    expect(error.message).toContain(url);
    expect(error.message).toContain('TypeError: Network connection lost');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('cacheKey', () => {
  test('puts the cache version in front of every part', () => {
    expect(CACHE_VERSION).toBe('v2');
    expect(cacheKey('character', 'na', '1')).toBe('v2:character:na:1');
  });

  test('accepts numbers and a page part', () => {
    expect(cacheKey('achievements', 'jp', '1', 'page2')).toBe('v2:achievements:jp:1:page2');
    expect(cacheKey('members', 'na', '9230000000000000001', 'page3')).toBe(
      'v2:members:na:9230000000000000001:page3',
    );
    expect(cacheKey('character', 'na', 12345678)).toBe('v2:character:na:12345678');
  });
});

describe('withFetchedAt', () => {
  test('adds the time as an ISO string', () => {
    expect(withFetchedAt({ A: 1 }, Date.UTC(2026, 10, 8, 2, 30))).toEqual({
      A: 1,
      FetchedAt: '2026-11-08T02:30:00.000Z',
    });
  });

  test('does not change the object it is given', () => {
    const data = { A: 1 };
    withFetchedAt(data, 0);
    expect(data).toEqual({ A: 1 });
  });
});

describe('parseDc', () => {
  const urlWith = (query: string) => new URL(`https://worker.test/character/1${query}`);

  test('defaults to na when no dc is given', () => {
    expect(parseDc(urlWith(''))).toBe('na');
    expect(parseDc(urlWith('?page=2'))).toBe('na');
  });

  test('accepts na and jp', () => {
    expect(parseDc(urlWith('?dc=na'))).toBe('na');
    expect(parseDc(urlWith('?dc=jp'))).toBe('jp');
  });

  test('rejects any other value with a BadRequestError', () => {
    for (const query of ['?dc=xx', '?dc=NA', '?dc=eu', '?dc=', '?dc=na,jp']) {
      expect(() => parseDc(urlWith(query)), query).toThrow(BadRequestError);
    }
  });
});

describe('parsePage', () => {
  const urlWith = (query: string) => new URL(`https://worker.test/character/1/achievements${query}`);

  test('is 1 when no page is given', () => {
    expect(parsePage(urlWith(''))).toBe(1);
    expect(parsePage(urlWith('?dc=jp'))).toBe(1);
  });

  test('is the number when it is a whole number from 1 written in digits', () => {
    expect(parsePage(urlWith('?page=1'))).toBe(1);
    expect(parsePage(urlWith('?page=2'))).toBe(2);
    expect(parsePage(urlWith('?page=20'))).toBe(20);
  });

  test('rejects anything else with a BadRequestError', () => {
    const values = ['abc', '0', '-1', '1.5', '', ' 2', '2 ', '+2', '1e2', 'NaN', 'Infinity', '9'.repeat(30)];
    for (const value of values) {
      expect(() => parsePage(urlWith(`?page=${encodeURIComponent(value)}`)), `page=${value}`).toThrow(
        BadRequestError,
      );
    }
  });
});

import { CharacterParser } from './parsers/character-parser';
import { ClassJobParser } from './parsers/classjob-parser';
import { AchievementsParser } from './parsers/achievements-parser';
import { FreeCompanyParser } from './parsers/freecompany-parser';
import { FreeCompanyMembersParser } from './parsers/freecompany-members-parser';
import { MinionParser } from './parsers/minion-parser';
import { MountParser } from './parsers/mount-parser';
import { CharacterSearchParser, type CharacterSearchData } from './parsers/search-parser';
import {
  BadRequestError,
  MOBILE_USER_AGENT,
  UpstreamError,
  cacheKey,
  errorStatus,
  fetchUpstreamText,
  parseDc,
  parsePage,
  withFetchedAt,
} from './lib/http';

export interface Env {
  LOGSTONE: KVNamespace;
  CACHE_TTL: string;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

// How many CACHE_TTLs an entry stays fresh. Collections and achievements change slowly, so they are kept twice as long.
const TTL_DEFAULT = 1;
const TTL_COLLECTION = 2;

// The shortest expiry KV accepts, in seconds.
const KV_MIN_EXPIRATION_TTL = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 檢查請求來源是否被允許
    if (!isRequestAllowed(request)) {
      return new Response('Forbidden', { status: 403 });
    }

    // 處理 CORS preflight 請求
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    // 處理不同的路徑
    const characterMatch = url.pathname.match(/^\/character\/(\d+)$/);
    const classJobMatch = url.pathname.match(/^\/character\/(\d+)\/classjob$/);
    const achievementsMatch = url.pathname.match(/^\/character\/(\d+)\/achievements$/);
    const freecompanyMatch = url.pathname.match(/^\/freecompany\/(\d+)$/);
    const freecompanyMembersMatch = url.pathname.match(/^\/freecompany\/(\d+)\/members$/);
    const minionsMatch = url.pathname.match(/^\/character\/(\d+)\/minions$/);
    const mountsMatch = url.pathname.match(/^\/character\/(\d+)\/mounts$/);
    const characterSearchMatch = url.pathname.match(/^\/search\/character$/);

    if (characterMatch) {
      return handleCharacterRequest(characterMatch[1], request, env);
    } else if (classJobMatch) {
      return handleClassJobRequest(classJobMatch[1], request, env);
    } else if (achievementsMatch) {
      return handleAchievementsRequest(achievementsMatch[1], request, env);
    } else if (freecompanyMatch) {
      return handleFreeCompanyRequest(freecompanyMatch[1], request, env);
    } else if (freecompanyMembersMatch) {
      return handleFreeCompanyMembersRequest(freecompanyMembersMatch[1], request, env);
    } else if (minionsMatch) {
      return handleMinionsRequest(minionsMatch[1], request, env);
    } else if (mountsMatch) {
      return handleMountsRequest(mountsMatch[1], request, env);
    } else if (characterSearchMatch) {
      return handleCharacterSearchRequest(request);
    } else {
      return new Response('Not Found', { status: 404 });
    }
  }
};

async function handleCharacterRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  try {
    const dc = parseDc(new URL(request.url));
    return await respondWithCache(request, env, cacheKey('character', dc, characterId), TTL_DEFAULT, () =>
      fetchCharacterData(characterId, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function handleClassJobRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  try {
    const dc = parseDc(new URL(request.url));
    return await respondWithCache(request, env, cacheKey('classjob', dc, characterId), TTL_DEFAULT, () =>
      fetchClassJobData(characterId, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchCharacterData(characterId: string, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/character/${characterId}`;

  const html = await fetchUpstreamText(url);

  // 解析 HTML 並提取角色資料
  const characterData = parseCharacterHTML(html, characterId);

  return {
    Character: {
      ID: parseInt(characterId),
      ...characterData
    }
  };
}

function parseCharacterHTML(html: string, characterId: string): any {
  const parser = new CharacterParser();
  return parser.parse(html);
}

// 檢查請求是否來自允許的來源
function isRequestAllowed(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');


  // 允許的來源域名
  const allowedDomains = ['ff14.tw'];

  // 檢查 Origin header
  if (origin) {
    const originUrl = new URL(origin);


    return allowedDomains.some(domain =>
      originUrl.hostname === domain || originUrl.hostname.endsWith(`.${domain}`)
    );
  }

  // 檢查 Referer header
  if (referer) {
    try {
      const refererUrl = new URL(referer);


      return allowedDomains.some(domain =>
        refererUrl.hostname === domain || refererUrl.hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }

  // 如果沒有 Origin 或 Referer，拒絕請求
  return false;
}

// CORS 處理函數
function getAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');

  if (!origin) return null;

  // 允許的來源域名
  const allowedOrigins = [
    'https://ff14.tw',
    'https://www.ff14.tw',
  ];


  if (allowedOrigins.includes(origin)) {
    return origin;
  }

  return null;
}

function handleCORS(request: Request): Response {
  const allowedOrigin = getAllowedOrigin(request);

  if (!allowedOrigin) {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  });
}

function createResponse(
  body: string,
  request: Request,
  cacheStatus: string | null = null,
  status: number = 200
): Response {
  const allowedOrigin = getAllowedOrigin(request);

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }

  if (cacheStatus) {
    headers['X-Cache-Status'] = cacheStatus;
  }

  return new Response(body, { status, headers });
}

// Answers from KV while the entry is fresh, otherwise loads the data from Lodestone and keeps it.
// Either way the response says when the data was fetched: a hit reports the time of the first fetch.
async function respondWithCache(
  request: Request,
  env: Env,
  key: string,
  ttlFactor: number,
  load: () => Promise<object>
): Promise<Response> {
  const ttl = parseInt(env.CACHE_TTL || '86400') * ttlFactor; // seconds

  const cached = await env.LOGSTONE.get(key);
  if (cached) {
    const cacheEntry: CacheEntry = JSON.parse(cached);

    if (Date.now() - cacheEntry.timestamp < ttl * 1000) {
      return createResponse(JSON.stringify(withFetchedAt(cacheEntry.data, cacheEntry.timestamp)), request, 'HIT');
    }
  }

  const data = await load();
  const cacheEntry: CacheEntry = { data, timestamp: Date.now() };
  try {
    // KV drops the entry once it is no longer served, so no entry stays in KV for good.
    await env.LOGSTONE.put(key, JSON.stringify(cacheEntry), {
      expirationTtl: Math.max(KV_MIN_EXPIRATION_TTL, ttl),
    });
  } catch (error) {
    // The answer is good even when it cannot be kept, for example once the free plan's 1,000 writes
    // a day are used up: it is still sent, and the next request asks Lodestone again.
    console.error(`Could not save ${key} in KV:`, error);
  }

  return createResponse(JSON.stringify(withFetchedAt(data, cacheEntry.timestamp)), request, 'MISS');
}

// Answers a failure with its status and `{ "error": <code> }`. 5xx are logged as errors. A 403 from
// Lodestone, answered as private, is logged as a warning: Lodestone refusing the Worker itself looks
// just the same. The rest are the caller's doing and are not logged.
function errorResponse(error: unknown, request: Request): Response {
  const { status, code } = errorStatus(error);
  if (status >= 500) {
    console.error('Error:', error);
  } else if (code === 'private') {
    const url = new URL(request.url);
    console.warn(`HTTP 403 from Lodestone for ${url.pathname}${url.search}, answered as private`);
  }
  return createResponse(JSON.stringify({ error: code }), request, null, status);
}

async function fetchClassJobData(characterId: string, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/character/${characterId}/class_job`;

  const html = await fetchUpstreamText(url);

  // 解析 HTML 並提取職業資料
  const parser = new ClassJobParser();
  const classJobData = parser.parse(html);

  return {
    CharacterID: parseInt(characterId),
    ClassJobs: classJobData
  };
}

async function handleAchievementsRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const dc = parseDc(url);
    const page = parsePage(url);
    return await respondWithCache(request, env, cacheKey('achievements', dc, characterId, `page${page}`), TTL_COLLECTION, () =>
      fetchAchievementsData(characterId, page, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchAchievementsData(characterId: string, page: number = 1, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/character/${characterId}/achievement?page=${page}`;

  const html = await fetchUpstreamText(url);

  // 解析 HTML 並提取成就資料
  const parser = new AchievementsParser();
  const achievementsData = parser.parse(html, page);

  return {
    CharacterID: parseInt(characterId),
    ...achievementsData
  };
}

async function handleFreeCompanyRequest(freecompanyId: string, request: Request, env: Env): Promise<Response> {
  try {
    const dc = parseDc(new URL(request.url));
    return await respondWithCache(request, env, cacheKey('freecompany', dc, freecompanyId), TTL_DEFAULT, () =>
      fetchFreeCompanyData(freecompanyId, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchFreeCompanyData(freecompanyId: string, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/freecompany/${freecompanyId}`;

  const html = await fetchUpstreamText(url);

  // 解析 HTML 並提取 Free Company 資料
  const parser = new FreeCompanyParser();
  const freecompanyData = parser.parse(html);

  return {
    FreeCompany: freecompanyData
  };
}

async function handleFreeCompanyMembersRequest(freecompanyId: string, request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const dc = parseDc(url);
    const page = parsePage(url);
    return await respondWithCache(request, env, cacheKey('members', dc, freecompanyId, `page${page}`), TTL_DEFAULT, () =>
      fetchFreeCompanyMembersData(freecompanyId, page, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchFreeCompanyMembersData(freecompanyId: string, page: number = 1, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/freecompany/${freecompanyId}/member?page=${page}`;

  const html = await fetchUpstreamText(url);

  // 解析 HTML 並提取成員資料
  const parser = new FreeCompanyMembersParser();
  const membersData = parser.parse(html, page);

  return {
    FreeCompanyID: freecompanyId,
    ...membersData
  };
}

async function handleMinionsRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  try {
    const dc = parseDc(new URL(request.url));
    return await respondWithCache(request, env, cacheKey('minions', dc, characterId), TTL_COLLECTION, () =>
      fetchMinionsData(characterId, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchMinionsData(characterId: string, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/character/${characterId}/minion`;

  // Only the mobile page writes the names of the minions.
  const html = await fetchUpstreamText(url, { headers: { 'User-Agent': MOBILE_USER_AGENT } });

  // 解析 HTML 並提取寵物資料
  const parser = new MinionParser();
  const minionsData = parser.parse(html);

  return {
    CharacterID: parseInt(characterId),
    ...minionsData
  };
}

async function handleMountsRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  try {
    const dc = parseDc(new URL(request.url));
    return await respondWithCache(request, env, cacheKey('mounts', dc, characterId), TTL_COLLECTION, () =>
      fetchMountsData(characterId, dc)
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function fetchMountsData(characterId: string, dc: 'na' | 'jp'): Promise<any> {
  const url = `https://${dc}.finalfantasyxiv.com/lodestone/character/${characterId}/mount`;

  // Only the mobile page writes the names of the mounts.
  const html = await fetchUpstreamText(url, { headers: { 'User-Agent': MOBILE_USER_AGENT } });

  // 解析 HTML 並提取坐騎資料
  const parser = new MountParser();
  const mountsData = parser.parse(html);

  return {
    CharacterID: parseInt(characterId),
    ...mountsData
  };
}

// Lodestone lists at most 1000 matches, 50 to a page.
const SEARCH_MAX_PAGE = 20;
const SEARCH_MAX_NAME_LENGTH = 40;
// The only parameters a search takes. Any other one is a 400: a filter under another name (Lodestone's
// own `worldname` instead of `world`, or a typo) would otherwise search every world without a word.
const SEARCH_PARAMETERS = new Set(['name', 'world', 'page', 'dc']);

// A search is kept nowhere. Not in KV: its free plan allows 1,000 writes a day, and searches are more
// frequent than looking up a character. Not in the Cache API either, which would do but is not needed.
// FetchedAt is the time of this fetch.
async function handleCharacterSearchRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const dc = parseDc(url);
    const { name, world, page } = parseSearchQuery(url);
    const data = await fetchCharacterSearchData(name, world, page, dc);
    return createResponse(JSON.stringify(withFetchedAt(data, Date.now())), request);
  } catch (error) {
    return errorResponse(error, request);
  }
}

// The `name`, `world` and `page` of a search, or a BadRequestError, also for a parameter a search does not
// take. `dc` is read apart, like everywhere else.
function parseSearchQuery(url: URL): { name: string; world: string; page: number } {
  for (const key of url.searchParams.keys()) {
    if (!SEARCH_PARAMETERS.has(key)) {
      throw new BadRequestError('Unknown parameter. A search takes name, world, page and dc');
    }
  }

  // A name is counted in characters, not in UTF-16 units: an emoji or a rare kanji is one character.
  const name = (url.searchParams.get('name') ?? '').trim();
  const length = [...name].length;
  if (length < 1 || length > SEARCH_MAX_NAME_LENGTH) {
    throw new BadRequestError(`Invalid name. Use 1 to ${SEARCH_MAX_NAME_LENGTH} characters`);
  }

  // The values of Lodestone's own `worldname`: nothing for all worlds, `_dc_` and a data center, or a world.
  const world = url.searchParams.get('world') ?? '';
  if (world !== '' && !/^(?:_dc_)?[A-Za-z]+$/.test(world)) {
    throw new BadRequestError('Invalid world. Use a world, a data center written as _dc_<name>, or nothing');
  }

  const page = parsePage(url);
  if (page > SEARCH_MAX_PAGE) {
    throw new BadRequestError(`Invalid page. Use a whole number from 1 to ${SEARCH_MAX_PAGE}`);
  }

  return { name, world, page };
}

async function fetchCharacterSearchData(
  name: string,
  world: string,
  page: number,
  dc: 'na' | 'jp'
): Promise<CharacterSearchData> {
  // URLSearchParams escapes the name, whatever it holds, so Lodestone reads the name as it was typed.
  const url = new URL(`https://${dc}.finalfantasyxiv.com/lodestone/character/`);
  url.searchParams.set('q', name);
  url.searchParams.set('worldname', world);
  url.searchParams.set('page', String(page));

  let html: string;
  try {
    html = await fetchUpstreamText(url.href);
  } catch (error) {
    // Lodestone answers a search with a 200 page even when nobody matches, and the page says so. A 404 or
    // a 403 for the search URL is therefore Lodestone failing, not the "no such character" or "private" of
    // the other endpoints: it is a 502 `upstream` like any other failure, logged like one with the status
    // Lodestone really sent.
    if (error instanceof UpstreamError && (error.status === 404 || error.status === 403)) {
      throw new UpstreamError(502, `Lodestone answered the search with HTTP ${error.status}, not with a page of results`);
    }
    throw error;
  }

  // 解析 HTML 並提取搜尋結果
  const parser = new CharacterSearchParser();
  return parser.parse(html);
}

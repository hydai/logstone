import { CharacterParser } from './parsers/character-parser';
import { ClassJobParser } from './parsers/classjob-parser';
import { AchievementsParser } from './parsers/achievements-parser';

export interface Env {
  LOGSTONE: KVNamespace;
  CACHE_TTL: string;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

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
    
    if (characterMatch) {
      return handleCharacterRequest(characterMatch[1], request, env);
    } else if (classJobMatch) {
      return handleClassJobRequest(classJobMatch[1], request, env);
    } else if (achievementsMatch) {
      return handleAchievementsRequest(achievementsMatch[1], request, env);
    } else {
      return new Response('Not Found', { status: 404 });
    }
  }
};

async function handleCharacterRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  const cacheKey = `character:${characterId}`;

  try {
    // 嘗試從 KV 快取取得資料
    const cached = await env.LOGSTONE.get(cacheKey);
    if (cached) {
      const cacheEntry: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      const ttl = parseInt(env.CACHE_TTL || '86400') * 1000; // 轉換為毫秒

      // 檢查快取是否過期
      if (now - cacheEntry.timestamp < ttl) {
        return createResponse(JSON.stringify(cacheEntry.data), request, 'HIT');
      }
    }

    // 快取未命中或已過期，從 Lodestone 取得資料
    const characterData = await fetchCharacterData(characterId);

    // 儲存到 KV 快取
    const cacheEntry: CacheEntry = {
      data: characterData,
      timestamp: Date.now()
    };
    await env.LOGSTONE.put(cacheKey, JSON.stringify(cacheEntry));

    return createResponse(JSON.stringify(characterData), request, 'MISS');

  } catch (error) {
    console.error('Error:', error);
    return createResponse(
      JSON.stringify({ error: 'Internal Server Error' }), 
      request, 
      null, 
      500
    );
  }
}

async function handleClassJobRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  const cacheKey = `classjob:${characterId}`;

  try {
    // 嘗試從 KV 快取取得資料
    const cached = await env.LOGSTONE.get(cacheKey);
    if (cached) {
      const cacheEntry: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      const ttl = parseInt(env.CACHE_TTL || '86400') * 1000; // 轉換為毫秒

      // 檢查快取是否過期
      if (now - cacheEntry.timestamp < ttl) {
        return createResponse(JSON.stringify(cacheEntry.data), request, 'HIT');
      }
    }

    // 快取未命中或已過期，從 Lodestone 取得資料
    const classJobData = await fetchClassJobData(characterId);

    // 儲存到 KV 快取
    const cacheEntry: CacheEntry = {
      data: classJobData,
      timestamp: Date.now()
    };
    await env.LOGSTONE.put(cacheKey, JSON.stringify(cacheEntry));

    return createResponse(JSON.stringify(classJobData), request, 'MISS');

  } catch (error) {
    console.error('Error:', error);
    return createResponse(
      JSON.stringify({ error: 'Internal Server Error' }), 
      request, 
      null, 
      500
    );
  }
}

async function fetchCharacterData(characterId: string): Promise<any> {
  const url = `https://na.finalfantasyxiv.com/lodestone/character/${characterId}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Character not found');
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  
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
  
  // 允許的來源域名
  const allowedOrigins = [
    'https://ff14.tw',
    'https://www.ff14.tw',
  ];
  
  if (origin && allowedOrigins.includes(origin)) {
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

async function fetchClassJobData(characterId: string): Promise<any> {
  const url = `https://na.finalfantasyxiv.com/lodestone/character/${characterId}/class_job`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Character not found');
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  
  // 解析 HTML 並提取職業資料
  const parser = new ClassJobParser();
  const classJobData = parser.parse(html);
  
  return {
    CharacterID: parseInt(characterId),
    ClassJobs: classJobData
  };
}

async function handleAchievementsRequest(characterId: string, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const cacheKey = `achievements:${characterId}:page${page}`;

  try {
    // 嘗試從 KV 快取取得資料
    const cached = await env.LOGSTONE.get(cacheKey);
    if (cached) {
      const cacheEntry: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      const ttl = parseInt(env.CACHE_TTL || '86400') * 1000 * 2; // 成就快取時間延長為 48 小時

      // 檢查快取是否過期
      if (now - cacheEntry.timestamp < ttl) {
        return createResponse(JSON.stringify(cacheEntry.data), request, 'HIT');
      }
    }

    // 快取未命中或已過期，從 Lodestone 取得資料
    const achievementsData = await fetchAchievementsData(characterId, page);

    // 儲存到 KV 快取
    const cacheEntry: CacheEntry = {
      data: achievementsData,
      timestamp: Date.now()
    };
    await env.LOGSTONE.put(cacheKey, JSON.stringify(cacheEntry));

    return createResponse(JSON.stringify(achievementsData), request, 'MISS');

  } catch (error) {
    console.error('Error:', error);
    return createResponse(
      JSON.stringify({ error: 'Internal Server Error' }), 
      request, 
      null, 
      500
    );
  }
}

async function fetchAchievementsData(characterId: string, page: number = 1): Promise<any> {
  const url = `https://na.finalfantasyxiv.com/lodestone/character/${characterId}/achievement?page=${page}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Character not found');
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();
  
  // 解析 HTML 並提取成就資料
  const parser = new AchievementsParser();
  const achievementsData = parser.parse(html, page);
  
  return {
    CharacterID: parseInt(characterId),
    ...achievementsData
  };
}
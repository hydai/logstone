import { onTestFinished, vi } from 'vitest';
import type { Env } from '../../src/index';

/**
 * A Worker environment backed by a Map instead of Cloudflare KV.
 * `kv` is the same Map the Worker reads and writes, so tests can seed and inspect it.
 */
export function createEnv(): { env: Env; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const env = {
    LOGSTONE: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
    },
    CACHE_TTL: '86400',
  } as unknown as Env;
  return { env, kv };
}

/** A GET request from the ff14.tw website, the only origin the Worker serves. */
export function workerRequest(path: string): Request {
  return new Request(`https://worker.test${path}`, {
    headers: { Origin: 'https://ff14.tw' },
  });
}

/**
 * Replace the global fetch for the current test, so the Worker never reaches Lodestone.
 * Returns the log of calls, which fills in as the Worker fetches.
 * The original fetch is put back when the test finishes.
 */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return calls;
}

// Pieces every endpoint shares: how a failure is reported, how a Lodestone page is
// fetched, how KV keys are written, how a response says when its data was fetched,
// and the `dc` and `page` parameters.

/** The request is wrong, for example an unknown data center. Answered with 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * Talking to Lodestone failed. Either Lodestone answered with an HTTP error status, which `status`
 * keeps, or it gave no answer or a page that broke off on the way, which is a 502 whose message
 * says what happened.
 */
export class UpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message = `Lodestone responded with HTTP ${status}`) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

/** Lodestone answered, but the page does not contain what the parser looks for. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export type ErrorCode = 'bad_request' | 'not_found' | 'private' | 'upstream' | 'internal';

/**
 * The HTTP status and the `error` code to answer with for a failure.
 * Only a failure that is none of ours, a bug in the Worker, is a 500.
 */
export function errorStatus(error: unknown): { status: number; code: ErrorCode } {
  if (error instanceof BadRequestError) {
    return { status: 400, code: 'bad_request' };
  }
  if (error instanceof UpstreamError) {
    // Lodestone has no such character or Free Company.
    if (error.status === 404) return { status: 404, code: 'not_found' };
    // Lodestone refuses to show the page, because the player keeps it private.
    if (error.status === 403) return { status: 403, code: 'private' };
    return { status: 502, code: 'upstream' };
  }
  if (error instanceof ParseError) {
    return { status: 502, code: 'upstream' };
  }
  return { status: 500, code: 'internal' };
}

/**
 * Fetch a Lodestone page and return its text. Everything that can go wrong while talking to
 * Lodestone becomes an UpstreamError, so nobody mistakes it for a bug in the Worker: an HTTP
 * error status keeps its status, and a request that gets no answer or a response whose body
 * breaks on the way (DNS, connection lost) is a 502.
 * Only the exchange with Lodestone is wrapped, that is the request and reading the body.
 * What the caller does with the text afterwards, such as parsing it, is the Worker's own
 * business: a failure there is not an UpstreamError.
 */
export async function fetchUpstreamText(url: string, init?: RequestInit): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw requestFailed(url, error);
  }
  if (!response.ok) {
    throw new UpstreamError(response.status);
  }
  try {
    return await response.text();
  } catch (error) {
    throw requestFailed(url, error);
  }
}

// A request that got no complete answer is a 502. Its message says what went wrong, because the
// failure is logged once, where the Worker answers it, and the caller only sees the 502.
function requestFailed(url: string, cause: unknown): UpstreamError {
  const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return new UpstreamError(502, `Request to Lodestone failed (${url}): ${reason}`);
}

/**
 * Bump this when what the parsers return changes shape or content: entries saved
 * under the old version are then never read again, and leave KV when they expire.
 * (Entries saved before v2 were given no expiry, so those stay until they are deleted.)
 */
export const CACHE_VERSION = 'v2';

/** `cacheKey('achievements', 'jp', '1', 'page2')` is `'v2:achievements:jp:1:page2'`. */
export function cacheKey(...parts: Array<string | number>): string {
  return [CACHE_VERSION, ...parts].join(':');
}

/** A copy of `data` with the time it was fetched from Lodestone, as an ISO string. */
export function withFetchedAt<T extends object>(data: T, fetchedAt: number): T & { FetchedAt: string } {
  return { ...data, FetchedAt: new Date(fetchedAt).toISOString() };
}

/** The `dc` query parameter: `na` when it is not given, a BadRequestError when it is not `na` or `jp`. */
export function parseDc(url: URL): 'na' | 'jp' {
  const dc = url.searchParams.get('dc');
  if (dc === null) return 'na';
  if (dc === 'na' || dc === 'jp') return dc;
  throw new BadRequestError('Invalid data center. Supported values: na, jp');
}

/**
 * The `page` query parameter: 1 when it is not given. Otherwise it must be a whole number
 * from 1 written in digits only, or a BadRequestError is thrown.
 */
export function parsePage(url: URL): number {
  const page = url.searchParams.get('page');
  if (page === null) return 1;
  const value = Number(page);
  if (/^\d+$/.test(page) && Number.isSafeInteger(value) && value >= 1) return value;
  throw new BadRequestError('Invalid page. Use a whole number from 1');
}

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers application that provides a comprehensive Final Fantasy XIV Lodestone data API. It's a serverless API written in TypeScript that fetches and parses HTML from the official FFXIV Lodestone website, offering structured JSON responses for characters (also found by name), free companies, achievements, and collections.

## Development Commands

```bash
# Install dependencies
npm install

# Run local development server (http://localhost:8787)
npm run dev

# Deploy to Cloudflare Workers
npm run deploy

# View live logs
npm run tail

# Generate TypeScript types
npm run types

# Run the tests (vitest; Lodestone is never contacted)
npm test

# Type check (manual); run it with the tests before every commit
npx tsc --noEmit
```

## Architecture

### Core Components

1. **Entry Point** (`src/index.ts`): Handles HTTP routing, CORS, KV caching and error responses
   - Character routes: `/character/{id}`, `/character/{id}/classjob`, `/character/{id}/achievements`, `/character/{id}/minions`, `/character/{id}/mounts`
   - Free Company routes: `/freecompany/{id}`, `/freecompany/{id}/members`
   - Search route: `/search/character?name=&world=&page=` (never cached: no KV, no Cache API)
   - Language site: All endpoints accept `?dc={na|jp}` parameter (defaults to `na`); `dc` picks which language site of Lodestone is read (`na` = English, `jp` = Japanese), so `jp` gives Japanese text
   - Cache TTL: 24 hours for basic data, 48 hours for achievements/collections
   - Every success carries `FetchedAt`, the ISO time the data was fetched from Lodestone (a cache hit reports the time of the first fetch)
   - Every failure is JSON `{ "error": <code> }`, sent by `errorResponse()` with the status from `errorStatus()` (`src/lib/http.ts`): 400 `bad_request` (wrong parameter), 403 `private` (Lodestone refuses the page), 404 `not_found` (Lodestone has no such character or Free Company; a search never gets 403 or 404, see Character Search), 502 `upstream` (Lodestone unreachable, answers another error status, or the page lacks what the parser looks for), 500 `internal` (a bug in the Worker). Only a disallowed Origin (plain text `Forbidden`, 403) and an unknown path (plain text `Not Found`, 404) are not JSON
   - CORS: Supports ff14.tw domains only

2. **Parsers** (`src/parsers/`): Specialized HTML parsers using htmlparser2
   - `character-parser.ts`: Character profile data (enhanced with FC/PvP info, and the icon and dyes of each gear slot)
   - `classjob-parser.ts`: Job levels for all classes
   - `achievements-parser.ts`: Achievement lists with pagination
   - `freecompany-parser.ts`: FC details including estate, reputation, focus
   - `freecompany-members-parser.ts`: FC member lists with pagination
   - `minion-parser.ts`: Minion collection data (name and icon of each minion)
   - `mount-parser.ts`: Mount collection data (name and icon of each mount)
   - `search-parser.ts`: Character search results with pagination (each match with its Free Company)

3. **Shared helpers** (`src/lib/`):
   - `http.ts`: the error classes (`BadRequestError`, `UpstreamError`, `ParseError`) with `errorStatus()`, `fetchUpstreamText()` (every failure to talk to Lodestone becomes an `UpstreamError`), `cacheKey()` with `CACHE_VERSION`, `withFetchedAt()`, `parseDc()`, `parsePage()` and `MOBILE_USER_AGENT`
   - `job-icons.ts`: job icon file name to job key, for `ActiveClassJob.Key` on the character endpoint

4. **Selectors** (`src/lib/lodestone-css-selectors/`): Modular CSS selector definitions
   - Organized by data type (profile/, freecompany/, search/, etc.)
   - Supports regex extraction, attribute selection, and nth-child selectors
   - Start from upstream (xivapi/lodestone-css-selectors) and keep the local changes listed under Constraints

### Key Implementation Details

- **Caching Strategy**:
  - Uses Cloudflare KV namespace "LOGSTONE"
  - Basic data: 24-hour cache
  - Collections/achievements: 48-hour cache
  - Cache keys are `v2:<endpoint>:<dc>:<id>`, plus `:page<N>` for paged endpoints (e.g., `v2:character:jp:123456`, `v2:achievements:jp:123456:page2`)
  - Every entry is written with an `expirationTtl` as long as it is served (at least 60 seconds, the least KV takes), so KV drops it once it is stale; a write KV refuses (e.g. past the free plan's 1,000 writes a day) is logged and the answer is still sent
  - Raise `CACHE_VERSION` in `src/lib/http.ts` whenever what a parser returns changes in shape or content: entries under the old version are never read again and leave KV when they expire (entries written before v2 have no expiry and stay)
  - Failures and character searches are never cached
  - Cache status exposed via `X-Cache-Status` header (searches and errors have none)

- **Parser Pattern**: All parsers follow consistent structure:
  - querySelector/querySelectorAll implementations
  - CSS selector parsing with pseudo-selector support
  - Regex-based data extraction
  - Error handling for missing elements
  - A 200 page without what the parser needs throws `ParseError` (502, never cached), so a Lodestone layout change is never kept as an empty answer: no character name (character, achievements), no achievement section (`.ldst__achievement`; the profile has the name too), not a single class job row, an achievement total above 0 with no row, no Free Company name, not a single member row (a company has at least its master), a mount or minion total above 0 with no row, or no row on a page without the mobile layout (`.ldst_main_content`: a blank page, someone else's page, or the desktop page Lodestone sends when it ignores the User-Agent); for the search, see Character Search. An achievement history with a total of 0 (or none) and no row inside its section is empty, not an error, and so is a collection with a total of 0 (or none) and no row inside the mobile layout

- **CORS Handling**:
  - Production: Restricted to ff14.tw domains only
  - Proper preflight request handling
  - No localhost exceptions in production

- **Mount/Minion Parsing**:
  - Fetched with a mobile User-Agent (`MOBILE_USER_AGENT`): only Lodestone's mobile layout writes the name of each row, the desktop layout just links to a tooltip
  - `Name` is the real name (English for `dc=na`, Japanese for `dc=jp`) and `Icon` the image of the row
  - A page that counts rows but shows none the parser can read is a `ParseError` (502), never an empty list that would be cached

- **Character Gear** (`Character.Gear`):
  - The profile page shows each slot as a box (`div.icon-c--<id>.ic_reflection_box`) with only an icon and its dyes; the item name and level load later from a tooltip (`data-lazy_load_url`, `…/equipment/tooltip/<slot>`), so they are not in the answer. The old `gearset.json` read tooltips that are no longer on the page and matched nothing
  - `Gear` is an array of `{ Slot, Icon, Dyes }` in the order MainHand, OffHand, Head, Body, Hands, Legs, Feet, Earrings, Necklace, Bracelets, Ring1, Ring2, SoulCrystal, Facewear, whatever the order of the page. A slot with no icon is left out, so a character with nothing equipped has `[]`
  - `Dyes` holds the `#rrggbb` of each coat that has paint (`painted_cover`), the first coat and then the second (`div.stain2-mirage`); `no_paint` and `unpaitable` (as the page spells it) coats give none
  - The page has no box 5 (the belt is gone); a box the parser does not know is not read. No captured page wears glasses, so the markup of `icon-c--glasses` with an item is assumed to be the one of the other slots

- **Character Search** (`/search/character`):
  - Parameters: `name` (1 to 40 characters after trimming, counted by character rather than UTF-16 unit), `world` (empty, `_dc_<DataCenter>` or a world name, letters only), `page` (1 to 20, the most Lodestone shows) and `dc`; a value outside these rules, or any other parameter (Lodestone's own `worldname`, a typo), is a 400, so a misspelled filter never becomes a search of every world
  - Reads `https://{dc}.finalfantasyxiv.com/lodestone/character/?q=&worldname=&page=` and parses it with `CharacterSearchParser`
  - The pager ("Page 1 of 20" / "1ページ / 20ページ") and the total ("1000 Total" / "1000 件") are read as numbers, never by the words around them; a total may have thousands separators ("1,000" is 1000)
  - An empty `Results` is an answer only when the page says that nobody matches, with `.parts__zero` (its notice) or with a total of 0: that is a 200 with `Results: []` and `Pagination` `{ Page: 1, PageTotal: 0, Total: 0 }`, whatever total the page states. A page with the window, no row the parser can read, no notice and a total that is missing or above 0 is a `ParseError` (502), so a changed layout is never reported as "nobody has that name"
  - Lodestone answers a search with a 200 page even when nobody matches, so a 404 or a 403 for the search URL is Lodestone failing: a 502 `upstream`, logged like any 5xx, not the `not_found` or `private` of the other endpoints

## Testing

`npm test` runs the vitest suite in `test/`. It never contacts Lodestone or the live Worker: the tests stub `fetch`, and the pages the parsers read are small hand-written copies of the real markup in `test/fixtures/`, with made-up names, IDs and avatars (never put a real player in a fixture). `test/helpers/env.ts` has the stand-ins for KV, requests and `fetch`.

Use the included `test.html` file for manual API testing against a running Worker (it has no tab for character search):
- Tabbed interface for different data types
- Quick test buttons with sample IDs
- Copy functionality for results
- Cache status indicators

## Deployment Configuration

The `wrangler.toml` file contains:
- KV namespace binding: `LOGSTONE` (ID: 76b5db6b84a24971842991318b448a24)
- Environment variable: `CACHE_TTL = "86400"` (24 hours in seconds)

## Current Implementation Status

### Implemented ✅
- Character profile with FC/PvP associations
- Character gear: the icon and dyes of each slot
- All job levels (combat, crafting, gathering, special)
- Achievement system with pagination
- Free Company details (all fields from nodestone)
- Free Company members with pagination
- Minion and mount collections
- Character search by name and world, each match with its Free Company

### Not Implemented ❌
- Free Company search
- Cross-world Linkshells (CWLS)
- Linkshells
- PvP Team details
- Equipment names and item levels

## Common Patterns

### Adding New Endpoints
1. Create parser in `src/parsers/`
2. Import parser in `index.ts`
3. Add route matching pattern
4. Add handler function following existing patterns
5. Update README with endpoint documentation

### Parser Development
- Extend existing parser patterns
- Use TypeScript interfaces for data structures
- Handle missing elements gracefully
- Support pagination where applicable

## Constraints

- **CSS Selectors**: Start from upstream (`xivapi/lodestone-css-selectors`) and keep the local changes in `lodestone-css-selectors/`:
  - `profile/classjob.json` is upstream's file at commit 245db29, byte for byte
  - `profile/mount.json` and `profile/minion.json` are written for the mobile pages
  - `search/character.json` is upstream's file at commit 245db29 plus `ENTRY.FREE_COMPANY` (the company's ID and name) and `TOTAL`
  - `freecompany/freecompany.json`: the `GRAND_COMPANY` and `RANKING` regexes also read the Japanese page, and the grand company name comes without the space before its standing
  - `profile/gearset.json` is removed: it read item tooltips that Lodestone no longer writes into the page. The gear is read in `character-parser.ts` instead (see Character Gear)
  - `profile/character.json`: the `GRAND_COMPANY` regex reads the whole name before ` / `; the English names have spaces ("Order of the Twin Adder"), and the old regex kept only the last word
- **Lodestone site**: `dc` picks which language site of Lodestone is read, `na` (English) or `jp` (Japanese); both show the same characters and Free Companies, whatever their data center
- **Read-only**: No write operations to Lodestone
- **CORS**: Must maintain security restrictions

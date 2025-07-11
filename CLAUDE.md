# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers application that provides a comprehensive Final Fantasy XIV Lodestone data API. It's a serverless API written in TypeScript that fetches and parses HTML from the official FFXIV Lodestone website, offering structured JSON responses for characters, free companies, achievements, and collections.

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

# Type check (manual)
npx tsc --noEmit
```

## Architecture

### Core Components

1. **Entry Point** (`src/index.ts`): Handles HTTP routing, CORS, and KV caching
   - Character routes: `/character/{id}`, `/character/{id}/classjob`, `/character/{id}/achievements`, `/character/{id}/minions`, `/character/{id}/mounts`
   - Free Company routes: `/freecompany/{id}`, `/freecompany/{id}/members`
   - Cache TTL: 24 hours for basic data, 48 hours for achievements/collections
   - CORS: Supports ff14.tw domains and localhost for development

2. **Parsers** (`src/parsers/`): Specialized HTML parsers using htmlparser2
   - `character-parser.ts`: Character profile data (enhanced with FC/PvP info)
   - `classjob-parser.ts`: Job levels for all classes
   - `achievements-parser.ts`: Achievement lists with pagination
   - `freecompany-parser.ts`: FC details including estate, reputation, focus
   - `freecompany-members-parser.ts`: FC member lists with pagination
   - `minion-parser.ts`: Minion collection data
   - `mount-parser.ts`: Mount collection data

3. **Selectors** (`src/lib/lodestone-css-selectors/`): Modular CSS selector definitions
   - Organized by data type (profile/, freecompany/, etc.)
   - Supports regex extraction, attribute selection, and nth-child selectors
   - Cannot be modified (as per project constraints)

### Key Implementation Details

- **Caching Strategy**: 
  - Uses Cloudflare KV namespace "LOGSTONE"
  - Basic data: 24-hour cache
  - Collections/achievements: 48-hour cache
  - Cache status exposed via `X-Cache-Status` header

- **Parser Pattern**: All parsers follow consistent structure:
  - querySelector/querySelectorAll implementations
  - CSS selector parsing with pseudo-selector support
  - Regex-based data extraction
  - Error handling for missing elements

- **CORS Handling**: 
  - Production: Restricted to ff14.tw domains only
  - Proper preflight request handling
  - No localhost exceptions in production

- **Mount/Minion Parsing**:
  - Names are extracted from tooltip URLs as identifiers
  - Format: `Mount-{hash}` or `Minion-{hash}`
  - Icons are properly extracted from img elements

## Testing

Use the included `test.html` file for comprehensive API testing:
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
- All job levels (combat, crafting, gathering, special)
- Achievement system with pagination
- Free Company details (all fields from nodestone)
- Free Company members with pagination
- Minion and mount collections

### Not Implemented ❌
- Search functionality (character/FC search)
- Cross-world Linkshells (CWLS)
- Linkshells
- PvP Team details
- Character attributes (STR, DEX, etc.)
- Character equipment/gearset

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

- **CSS Selectors**: Cannot modify files in `lodestone-css-selectors/`
- **Region**: Only supports NA (North America) data centers
- **Read-only**: No write operations to Lodestone
- **CORS**: Must maintain security restrictions
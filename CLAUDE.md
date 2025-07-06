# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers application that parses Final Fantasy XIV Lodestone character data. It's a serverless API written in TypeScript that fetches and parses HTML from the official FFXIV Lodestone website.

## Development Commands

```bash
# Install dependencies
yarn install

# Run local development server (http://localhost:8787)
yarn dev

# Deploy to Cloudflare Workers
yarn deploy

# View live logs
yarn tail

# Generate TypeScript types
yarn types
```

## Architecture

### Core Components

1. **Entry Point** (`src/index.ts`): Handles HTTP routing, CORS, and KV caching
   - Routes: `/character/{characterId}`
   - Cache TTL: 24 hours (configurable via CACHE_TTL env var)
   - CORS: Restricted to ff14.tw domains and localhost:3000

2. **Parser** (`src/parsers/character-parser.ts`): HTML parsing with htmlparser2
   - Uses CSS selectors defined in JSON files
   - Converts Lodestone HTML to structured JSON

3. **Selectors** (`src/lib/lodestone-css-selectors/profile/*.json`): Modular CSS selector definitions
   - Each JSON file targets specific data types (character, attributes, gearset, etc.)
   - Supports regex extraction and attribute selection

### Key Implementation Details

- **Caching**: Uses Cloudflare KV namespace "LOGSTONE" for 24-hour caching
- **Region**: Only supports NA (North America) data center characters
- **Error Handling**: Returns proper HTTP status codes (404 for not found, 500 for errors)
- **Response Headers**: Includes `X-Cache-Status` to indicate cache hits/misses

## Deployment Configuration

The `wrangler.toml` file contains:
- KV namespace binding: `LOGSTONE` (ID: 76b5db6b84a24971842991318b448a24)
- Environment variable: `CACHE_TTL = "86400"` (24 hours in seconds)

## Current Limitations

- Read-only API (no write operations)
- Only parses basic character information
- HTML parsing may miss complex data structures
- Regional restriction to NA servers
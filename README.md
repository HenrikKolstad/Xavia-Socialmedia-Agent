# Xavia Agent 007

Automated social media posting agent for **XaviaEstate.com**. Scrapes new property listings and posts them to Instagram and TikTok.

## What it does

1. **Scrapes** XaviaEstate.com for the latest property listings
2. **Detects** new properties not yet posted (tracked in `data/posted.json`)
3. **Generates** engaging captions with property details, emojis, and hashtags
4. **Posts** to Instagram (carousel/single image) and TikTok (photo slideshow)
5. **Runs on a schedule** (default: daily at 9 AM via cron)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API credentials

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

#### Instagram Setup
1. Create a **Facebook Developer App** at [developers.facebook.com](https://developers.facebook.com)
2. Add the **Instagram Graph API** product
3. Connect your **XaviaEstate Instagram Professional Account** to a Facebook Business Page
4. Generate a **Page Access Token** with scopes: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`
5. Get your **Instagram Business Account ID** from the API Explorer
6. Set `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_BUSINESS_ACCOUNT_ID` in `.env`

#### TikTok Setup
1. Create a **TikTok Developer App** at [developers.tiktok.com](https://developers.tiktok.com)
2. Add the **Content Posting API** scope
3. Complete the **OAuth flow** to get an access token for the XaviaEstate TikTok account
4. Set `TIKTOK_ACCESS_TOKEN` in `.env`

### 3. Test with dry run

```bash
npm run dev
```

This runs with `DRY_RUN=true` by default — it scrapes properties and shows what would be posted without actually posting.

### 4. Run for real

Set `DRY_RUN=false` in `.env`, then:

```bash
npm run build
npm start
```

The agent will:
- Post any new properties immediately on startup
- Then run on the configured cron schedule (default: every day at 9 AM)

### One-time run (no scheduling)

```bash
node dist/index.js --once
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Run agent in development mode (ts-node) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled agent |
| `npm run scrape` | Just scrape properties (no posting) |
| `npm test` | Dry run mode |

## Project Structure

```
src/
  index.ts      - Main agent: orchestrator + cron scheduler
  scraper.ts    - Scrapes XaviaEstate.com for property listings
  content.ts    - Generates Instagram/TikTok captions
  instagram.ts  - Instagram Graph API integration
  tiktok.ts     - TikTok Content Posting API integration
  storage.ts    - Tracks posted properties (JSON file)
  config.ts     - Environment config
  types.ts      - TypeScript interfaces
```

## Hosting

For always-on scheduling, deploy to any Node.js host:

- **VPS** (DigitalOcean, Hetzner) — run with `pm2` or `systemd`
- **Railway / Render** — deploy as a background worker
- **GitHub Actions** — use a scheduled workflow to run `--once` daily

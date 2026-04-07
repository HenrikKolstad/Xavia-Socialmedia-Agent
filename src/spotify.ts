import axios from "axios";
import * as cheerio from "cheerio";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { log } from "./logger";

/**
 * Scrapes Spotify Global Top 50 from the web (no API keys needed).
 * Picks a random track, ensuring no repeat within last 5 songs.
 * Tracks history in data/music_history.json.
 */

const PLAYLIST_URL = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
const MIN_GAP = 5; // Minimum songs before same song can be used again
const HISTORY_FILE = path.join("data", "music_history.json");

export interface SpotifyTrack {
  name: string;
  artist: string;
  query: string; // "artist song" for searching on IG
}

/**
 * Load recently used song queries from history file.
 */
function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
      return data.recent || [];
    }
  } catch {}
  return [];
}

/**
 * Save a song query to history (keep last MIN_GAP entries).
 */
function saveToHistory(query: string): void {
  const recent = loadHistory();
  recent.push(query);
  // Only keep last MIN_GAP entries
  const trimmed = recent.slice(-MIN_GAP);
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ recent: trimmed }, null, 2));
  } catch {}
}

/**
 * Scrape track names from Spotify playlist page.
 */
async function scrapeTopTracks(): Promise<SpotifyTrack[]> {
  try {
    const response = await axios.get(PLAYLIST_URL, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const $ = cheerio.load(response.data);
    const tracks: SpotifyTrack[] = [];

    // Spotify embeds track data in meta tags and structured data
    // Look for JSON-LD or Spotify's embedded state
    const scripts = $('script[type="application/ld+json"]');
    scripts.each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "{}");
        if (json.track) {
          for (const t of json.track) {
            if (t.name && t.byArtist?.name) {
              tracks.push({
                name: t.name,
                artist: t.byArtist.name,
                query: `${t.byArtist.name} ${t.name}`,
              });
            }
          }
        }
      } catch {}
    });

    // Fallback: parse meta tags for track info
    if (tracks.length === 0) {
      $('meta[name="music:song"]').each((_, el) => {
        const content = $(el).attr("content") || "";
        // Extract track name from URL pattern
        const match = content.match(/track\/([^?]+)/);
        if (match) {
          tracks.push({
            name: decodeURIComponent(match[1].replace(/-/g, " ")),
            artist: "",
            query: decodeURIComponent(match[1].replace(/-/g, " ")),
          });
        }
      });
    }

    // Fallback: try parsing the HTML title tags for track listings
    if (tracks.length === 0) {
      $("a[href*='/track/']").each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 1 && text.length < 100) {
          tracks.push({ name: text, artist: "", query: text });
        }
      });
    }

    return tracks;
  } catch (err: any) {
    log.warn("Spotify", `Failed to scrape playlist: ${err.message || err}`);
    return [];
  }
}

/**
 * Get a random track from Spotify Global Top 50.
 * Ensures minimum 5 different songs before repeating.
 */
export async function getRandomTopTrack(): Promise<SpotifyTrack | null> {
  log.info("Spotify", `Scraping ${chalk.cyanBright("Global Top 50")} playlist...`);

  const tracks = await scrapeTopTracks();

  if (tracks.length === 0) {
    log.warn("Spotify", "Could not scrape any tracks from playlist");
    return null;
  }

  log.info("Spotify", `Found ${chalk.bold.greenBright(tracks.length.toString())} tracks`);

  // Filter out recently used songs
  const recentQueries = loadHistory();
  const available = tracks.filter((t) => !recentQueries.includes(t.query));

  // If all filtered out (unlikely with 50 tracks and 5 gap), use full list
  const pool = available.length > 0 ? available : tracks;

  // Pick random track
  const track = pool[Math.floor(Math.random() * pool.length)];

  // Save to history
  saveToHistory(track.query);

  log.info("Spotify", `Selected: ${chalk.bold.cyanBright(track.name)}${track.artist ? ` by ${chalk.magentaBright(track.artist)}` : ""}`);
  return track;
}

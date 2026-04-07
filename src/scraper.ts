import chalk from "chalk";
import axios from "axios";
import * as cheerio from "cheerio";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { config } from "./config";
import { Property } from "./types";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

const scrapeHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

/**
 * Scrapes property listings from XaviaEstate.com using Python cloudscraper
 * to bypass the JavaScript challenge page.
 */
export async function scrapeLatestProperties(): Promise<Property[]> {
  const scrapeUrl = `${config.baseUrl}/en`;
  log.info("Scraper", `Fetching ${chalk.cyanBright(scrapeUrl)} ...`);

  try {
    const scriptPath = path.join(__dirname, "..", "scripts", "scrape_listings.py");
    const pythonCmd = process.platform === "win32" ? "py" : "python3";

    const { stdout, stderr } = await execFileAsync(pythonCmd, [scriptPath, scrapeUrl], {
      timeout: 60000,
    });

    if (stderr) {
      log.info("Scraper", stderr.trim());
    }

    const rawProperties = JSON.parse(stdout.trim());
    const properties: Property[] = rawProperties.map((p: any) => ({
      id: p.id || "",
      title: p.title || "",
      price: p.price || 0,
      priceFormatted: p.priceFormatted || formatPrice(p.price || 0),
      location: p.location || "",
      bedrooms: p.bedrooms || 0,
      bathrooms: p.bathrooms || 0,
      sizeInterior: p.sizeInterior || 0,
      sizePlot: p.sizePlot || null,
      propertyType: p.propertyType || "Property",
      url: p.url || "",
      imageUrls: p.imageUrls || [],
      scrapedAt: new Date().toISOString(),
    }));

    log.success("Scraper", `Found ${chalk.bold.greenBright(properties.length.toString())} properties`);

    // Sort newest first — higher property URL number = newer listing
    properties.sort((a, b) => {
      const aNum = parseInt(a.url.match(/\/property\/(\d+)\//)?.[1] || "0", 10);
      const bNum = parseInt(b.url.match(/\/property\/(\d+)\//)?.[1] || "0", 10);
      return bNum - aNum;
    });

    return properties;
  } catch (err: any) {
    log.error("Scraper", `Failed to scrape: ${err.message}`);
    return [];
  }
}

/**
 * Scrapes property detail page for high-res images using Selenium via Python.
 * Falls back to static scraping if Selenium isn't available.
 */
export async function scrapePropertyDetail(
  url: string
): Promise<Partial<Property>> {
  log.info("Scraper", `Fetching detail: ${chalk.cyanBright(url)}`);

  // Try Python Selenium scraper for full-res images
  try {
    const scriptPath = path.join(__dirname, "..", "scripts", "scrape_detail.py");
    const pythonCmd = process.platform === "win32" ? "py" : "python3";

    const { stdout, stderr } = await execFileAsync(pythonCmd, [scriptPath, url], {
      timeout: 60000,
    });

    if (stderr) {
      log.info("Scraper", stderr.trim());
    }

    const result = JSON.parse(stdout.trim());
    // New format: { all_images: [...], selected: [...] }
    const imageUrls = result.selected || result.all_images || (Array.isArray(result) ? result : []);
    if (imageUrls.length > 0) {
      log.success("Scraper", `Found ${chalk.yellowBright((result.all_images?.length || imageUrls.length).toString())} total, using ${chalk.bold.greenBright(imageUrls.length.toString())} diverse images`);
      return { imageUrls };
    }
  } catch (err: any) {
    log.warn("Scraper", `Selenium failed, trying static fallback: ${err.message}`);
  }

  // Fallback: static HTML scraping
  try {
    const { data: html } = await axios.get(url, {
      headers: scrapeHeaders,
      timeout: 30000,
    });

    const $ = cheerio.load(html);
    const imageUrls: string[] = [];

    // Try all possible image sources
    $("img").each((_i, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (
        src &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        !src.includes("arrow") &&
        !src.includes("flag") &&
        (src.includes(".jpg") || src.includes(".jpeg") || src.includes(".png") || src.includes(".webp"))
      ) {
        const fullUrl = src.startsWith("/") ? config.baseUrl + src : src;
        if (!imageUrls.includes(fullUrl)) imageUrls.push(fullUrl);
      }
    });

    // Check og:image
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage && !imageUrls.includes(ogImage)) {
      imageUrls.unshift(ogImage);
    }

    return { imageUrls };
  } catch (err) {
    log.error("Scraper", `Failed to scrape detail page: ${url}`);
    return {};
  }
}

function parsePropertyFromLink(
  $: cheerio.CheerioAPI,
  linkEl: cheerio.Cheerio<any>,
  href: string
): Property | null {
  const url = href.startsWith("http") ? href : config.baseUrl + href;

  const idMatch = href.match(/XE\w+/i);
  const id = idMatch ? idMatch[0] : "";
  if (!id) return null;

  const slugMatch = href.match(/\/property\/\d+\/(.+)/);
  const slug = slugMatch ? slugMatch[1].replace(/-/g, " ").replace(/XE\w+/i, "").trim() : "";

  const title = linkEl.text().trim() || slug;
  const propertyType = extractPropertyType(slug || title);
  const location = extractLocation(slug || title);

  // Search up to 3 parent levels for price/specs
  let contextEl = linkEl.parent();
  let contextText = contextEl.text();
  for (let i = 0; i < 3; i++) {
    if (/€[\d,.]+/.test(contextText)) break;
    contextEl = contextEl.parent();
    contextText = contextEl.text();
  }
  const priceMatch = contextText.match(/€\s?[\d.,]+|[\d.,]+\s?€/);
  const price = priceMatch ? parsePrice(priceMatch[0]) : 0;

  const bedrooms = extractNumber(contextText, /(\d+)\s*(?:bed|dorm|hab)/i) || 0;
  const bathrooms = extractNumber(contextText, /(\d+)\s*(?:bath|baño)/i) || 0;
  const sizeInterior = extractNumber(contextText, /(\d+)\s*m²/i) || 0;

  return {
    id,
    title: title || `${propertyType} in ${location}`,
    price,
    priceFormatted: formatPrice(price),
    location,
    bedrooms,
    bathrooms,
    sizeInterior,
    sizePlot: null,
    propertyType,
    url,
    imageUrls: [],
    scrapedAt: new Date().toISOString(),
  };
}

function parsePrice(text: string): number {
  const cleaned = text.replace(/[^0-9]/g, "");
  return parseInt(cleaned, 10) || 0;
}

function formatPrice(price: number): string {
  if (price >= 1_000_000) return `€${(price / 1_000_000).toFixed(1)}M`;
  return `€${(price / 1000).toFixed(0)}K`;
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? parseInt(match[1], 10) : null;
}

function extractLocation(text: string): string {
  const inMatch = text.match(/in\s+(.+?)(?:\s*[-,]|$)/i);
  return inMatch ? inMatch[1].trim() : "";
}

function extractPropertyType(text: string): string {
  const lower = text.toLowerCase();
  const types = ["villa", "apartment", "penthouse", "townhouse", "town house", "bungalow", "duplex", "quad house", "quadhouse", "studio"];
  for (const t of types) {
    if (lower.includes(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return "Property";
}

if (require.main === module) {
  scrapeLatestProperties().then((props) => {
    console.log(JSON.stringify(props, null, 2));
    console.log(`Total: ${props.length} properties`);
  });
}

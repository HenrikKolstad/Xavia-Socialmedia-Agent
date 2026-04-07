import fs from "fs";
import path from "path";
import { config } from "./config";
import { PostRecord, PostedData } from "./types";

/**
 * Tracks which properties have been posted to avoid duplicates.
 * Uses two mechanisms:
 * 1. posted.json — full history of posted property IDs
 * 2. watermark.json — highest property URL number seen, so new listings
 *    are detected even if posted.json gets wiped
 */

const WATERMARK_FILE = path.join(config.dataDir, "watermark.json");

function ensureDataDir(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

export function loadPostedData(): PostedData {
  ensureDataDir();
  if (!fs.existsSync(config.postedFile)) {
    return { posts: [] };
  }
  const raw = fs.readFileSync(config.postedFile, "utf-8");
  return JSON.parse(raw) as PostedData;
}

export function savePostedData(data: PostedData): void {
  ensureDataDir();
  fs.writeFileSync(config.postedFile, JSON.stringify(data, null, 2));
}

export function isPropertyPosted(propertyId: string): boolean {
  const data = loadPostedData();
  return data.posts.some((p) => p.propertyId === propertyId);
}

export function recordPost(record: PostRecord): void {
  const data = loadPostedData();
  const existing = data.posts.find((p) => p.propertyId === record.propertyId);
  if (existing) {
    Object.assign(existing, record);
  } else {
    data.posts.push(record);
  }
  savePostedData(data);
}

export function getPostHistory(): PostRecord[] {
  return loadPostedData().posts;
}

/**
 * Get the highest property URL number we've processed.
 * Properties on xavia have URLs like /property/1344/ — higher = newer.
 */
export function getWatermark(): number {
  ensureDataDir();
  try {
    if (fs.existsSync(WATERMARK_FILE)) {
      const data = JSON.parse(fs.readFileSync(WATERMARK_FILE, "utf-8"));
      return data.lastPropertyNum || 0;
    }
  } catch {}
  return 0;
}

/**
 * Save the highest property number we've seen.
 */
export function setWatermark(num: number): void {
  ensureDataDir();
  const current = getWatermark();
  if (num > current) {
    fs.writeFileSync(WATERMARK_FILE, JSON.stringify({ lastPropertyNum: num, updatedAt: new Date().toISOString() }, null, 2));
  }
}

/**
 * Extract the property number from a URL like /property/1344/...
 */
export function getPropertyNum(url: string): number {
  const match = url.match(/\/property\/(\d+)\//);
  return match ? parseInt(match[1], 10) : 0;
}

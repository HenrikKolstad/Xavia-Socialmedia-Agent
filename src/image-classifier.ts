import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { config } from "./config";
import { log } from "./logger";
import chalk from "chalk";

export type RoomType =
  | "exterior"
  | "pool"
  | "terrace"
  | "living_room"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "garden"
  | "view"
  | "other";

interface ClassifiedImage {
  url: string;
  room: RoomType;
}

// Ideal reel order — exterior hook first, interior flow, closer at end
const REEL_ORDER: RoomType[] = [
  "exterior",
  "pool",
  "terrace",
  "view",
  "living_room",
  "kitchen",
  "bedroom",
  "bathroom",
  "garden",
  "other",
];

/**
 * Classify property images using Claude vision.
 * Sends all images in one request to save time/cost.
 */
export async function classifyImages(imageUrls: string[]): Promise<ClassifiedImage[]> {
  if (!config.anthropicApiKey) {
    log.warn("Vision", "No Anthropic API key — returning images in original order");
    return imageUrls.map((url) => ({ url, room: "other" as RoomType }));
  }

  try {
    const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

    // Download images as base64 for vision API
    const imageContents: Anthropic.ImageBlockParam[] = [];
    for (const url of imageUrls) {
      try {
        const resp = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 10000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        const base64 = Buffer.from(resp.data).toString("base64");
        const contentType = resp.headers["content-type"] || "image/jpeg";
        imageContents.push({
          type: "image",
          source: {
            type: "base64",
            media_type: contentType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: base64,
          },
        });
      } catch {
        // If download fails, add placeholder
        imageContents.push(null as any);
      }
    }

    // Filter out failed downloads
    const validIndices: number[] = [];
    const validImages: Anthropic.ImageBlockParam[] = [];
    imageContents.forEach((img, i) => {
      if (img) {
        validIndices.push(i);
        validImages.push(img);
      }
    });

    if (validImages.length === 0) {
      return imageUrls.map((url) => ({ url, room: "other" }));
    }

    // Build message: all images + one prompt
    const content: Anthropic.ContentBlockParam[] = [];
    validImages.forEach((img, i) => {
      content.push(img);
      content.push({ type: "text", text: `Image ${i + 1}:` });
    });
    content.push({
      type: "text",
      text: `Classify each image above as one of: exterior, pool, terrace, living_room, kitchen, bedroom, bathroom, garden, view, other.

Reply with ONLY a JSON array of strings, one per image, in order. Example: ["exterior","pool","kitchen","bedroom"]`,
    });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "[]";
    // Extract JSON array from response
    const match = text.match(/\[.*\]/s);
    if (!match) {
      log.warn("Vision", "Could not parse classification response");
      return imageUrls.map((url) => ({ url, room: "other" }));
    }

    const labels: string[] = JSON.parse(match[0]);

    // Map back to full image list
    const results: ClassifiedImage[] = imageUrls.map((url) => ({ url, room: "other" as RoomType }));
    labels.forEach((label, i) => {
      if (i < validIndices.length) {
        const originalIdx = validIndices[i];
        results[originalIdx].room = (REEL_ORDER.includes(label as RoomType) ? label : "other") as RoomType;
      }
    });

    const summary = results.map((r) => r.room).join(", ");
    log.info("Vision", `Classified ${results.length} images: ${chalk.cyanBright(summary)}`);

    return results;
  } catch (err: any) {
    log.warn("Vision", `Classification failed: ${err.message || err} — using original order`);
    return imageUrls.map((url) => ({ url, room: "other" }));
  }
}

/**
 * Sort images into ideal reel order.
 * Exterior first (hook), then pool/terrace, interior flow, closer at end.
 */
export function sortForReel(images: ClassifiedImage[]): string[] {
  const sorted = [...images].sort((a, b) => {
    const aIdx = REEL_ORDER.indexOf(a.room);
    const bIdx = REEL_ORDER.indexOf(b.room);
    return aIdx - bIdx;
  });
  return sorted.map((img) => img.url);
}

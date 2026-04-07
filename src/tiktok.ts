import chalk from "chalk";
import axios from "axios";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { Property } from "./types";
import { generateTikTokCaption } from "./content";
import { log } from "./logger";

const TIKTOK_API = "https://open.tiktokapis.com/v2";

/**
 * Posts a property to TikTok as a photo post (slideshow).
 */
export async function postToTikTok(
  property: Property
): Promise<string | null> {
  const { accessToken } = config.tiktok;

  if (!accessToken) {
    log.warn("TikTok", "Missing credentials. Set TIKTOK_ACCESS_TOKEN in .env");
    return null;
  }

  if (property.imageUrls.length === 0) {
    log.error("TikTok", `No images for property ${property.id}`);
    return null;
  }

  const caption = generateTikTokCaption(property);
  log.info("TikTok", `Posting ${chalk.bold.yellowBright(property.id)}: ${chalk.cyanBright(property.title)}`);

  if (config.dryRun) {
    log.info("TikTok", chalk.yellowBright("DRY RUN — would post with caption:"));
    console.log(chalk.white(caption));
    return `dry-run-tt-${property.id}`;
  }

  try {
    const images = property.imageUrls.slice(0, 10);

    const { data: initResponse } = await axios.post(
      `${TIKTOK_API}/post/publish/content/init/`,
      {
        post_info: {
          title: caption,
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: 0,
          photo_images: images.map((url) => url),
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    if (initResponse.error?.code !== "ok" && initResponse.error?.code) {
      throw new Error(
        `TikTok API error: ${initResponse.error.code} - ${initResponse.error.message}`
      );
    }

    const publishId = initResponse.data?.publish_id;
    log.success("TikTok", `Photo post initiated: ${chalk.bold.greenBright(publishId)}`);

    if (publishId) {
      await waitForTikTokPublish(publishId, accessToken);
    }

    return publishId || "initiated";
  } catch (err) {
    log.error("TikTok", `Failed to post property ${property.id}: ${err}`);
    return null;
  }
}

async function waitForTikTokPublish(
  publishId: string,
  token: string,
  maxAttempts: number = 15
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const { data } = await axios.post(
        `${TIKTOK_API}/post/publish/status/fetch/`,
        { publish_id: publishId },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
        }
      );

      const status = data.data?.status;
      if (status === "PUBLISH_COMPLETE") {
        log.success("TikTok", "Post published successfully!");
        return;
      }
      if (status === "FAILED") {
        log.error("TikTok", `Publish failed: ${data.data?.fail_reason}`);
        return;
      }
      log.info("TikTok", `Status: ${chalk.yellowBright(status)} (attempt ${i + 1})`);
    } catch (err) {
      log.warn("TikTok", `Status check failed (attempt ${i + 1})`);
    }
  }
  log.warn("TikTok", "Timed out waiting for publish confirmation");
}

/**
 * Downloads an image and creates a simple slideshow-style video.
 * Fallback if the TikTok photo post API isn't available.
 */
export async function downloadPropertyImage(
  imageUrl: string,
  outputPath: string
): Promise<string | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });

    await sharp(Buffer.from(response.data))
      .resize(1080, 1920, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    return outputPath;
  } catch (err) {
    log.error("TikTok", `Failed to download image: ${imageUrl}`);
    return null;
  }
}

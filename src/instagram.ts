import chalk from "chalk";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { Property } from "./types";
import { generateCaption, generateHashtags } from "./content";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

const MAX_IMAGES = 15;

/**
 * Posts a property to Instagram using Python's instagrapi.
 * - Downloads up to 4 images, fits to 4:5 with white padding (no cropping)
 * - Posts with caption
 * - Adds hashtags as first comment
 */
export async function postToInstagram(
  property: Property,
  captionIndex: number = 0
): Promise<string | null> {
  const caption = await generateCaption(property, captionIndex);
  const hashtags = generateHashtags(property);
  log.info("Instagram", `Posting ${chalk.bold.yellowBright(property.id)}: ${chalk.cyanBright(property.title)}`);

  if (config.dryRun) {
    log.info("Instagram", chalk.yellowBright("DRY RUN — would post with caption:"));
    console.log(chalk.white(caption));
    log.info("Instagram", chalk.yellowBright("First comment hashtags:"));
    console.log(chalk.gray(hashtags));
    return `dry-run-ig-${property.id}`;
  }

  if (!config.instagram.username || !config.instagram.password) {
    log.error("Instagram", "Missing credentials. Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env");
    return null;
  }

  if (property.imageUrls.length === 0) {
    log.error("Instagram", `No images for property ${property.id}`);
    return null;
  }

  // Download and process up to 4 images
  const tempDir = path.join(config.dataDir, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFiles: string[] = [];
  try {
    const urls = property.imageUrls.slice(0, MAX_IMAGES);
    for (let i = 0; i < urls.length; i++) {
      const imgPath = await downloadAndProcessImage(
        urls[i],
        path.join(tempDir, `${property.id}_${i}.jpg`)
      );
      if (imgPath) tempFiles.push(imgPath);
    }

    if (tempFiles.length === 0) {
      log.error("Instagram", `No images could be downloaded for ${property.id}`);
      return null;
    }

    // Call Python script
    const scriptPath = path.join(__dirname, "..", "scripts", "ig_post.py");
    const args = [
      scriptPath,
      "--username", config.instagram.username,
      "--password", config.instagram.password,
      "--caption", caption,
      "--hashtags", hashtags,
      "--session", path.join(config.dataDir, "ig_session.json"),
    ];

    if (tempFiles.length === 1) {
      args.push("--image", tempFiles[0]);
    } else {
      args.push("--album", ...tempFiles);
    }

    log.info("Instagram", `Uploading ${chalk.bold.greenBright(tempFiles.length.toString())} image(s) via instagrapi...`);

    const pythonCmd = process.platform === "win32" ? "py" : "python3";

    const { stdout, stderr } = await execFileAsync(pythonCmd, args, {
      timeout: 120000,
    });

    if (stderr) {
      log.info("Instagram", stderr.trim());
    }

    const result = JSON.parse(stdout.trim());

    if (result.error) {
      log.error("Instagram", result.error);
      return null;
    }

    log.success("Instagram", `Published ${chalk.magentaBright(result.type)}: ${chalk.bold.greenBright(result.media_id)}`);
    return result.media_id;
  } catch (err: any) {
    log.error("Instagram", `Failed to post property ${property.id}: ${err.message || err}`);

    if (err.message?.includes("ENOENT") || err.message?.includes("not found")) {
      log.error("Instagram", "Python not found! Install Python and instagrapi:");
      console.log(chalk.yellowBright("  1. Install Python: https://www.python.org/downloads/"));
      console.log(chalk.yellowBright("  2. Run: pip install instagrapi"));
    }

    return null;
  } finally {
    // Cleanup temp files
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

/**
 * Downloads an image, converts to JPEG, fits within 4:5 ratio with white padding.
 * Preserves original image without aggressive cropping/zooming.
 */
async function downloadAndProcessImage(
  url: string,
  outputPath: string
): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    // Fit inside 4:5 ratio (1080x1350) with white padding — no cropping/zooming
    await sharp(Buffer.from(response.data))
      .resize(1080, 1350, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .jpeg({ quality: 95 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    log.info("Instagram", `Image saved: ${chalk.cyanBright(path.basename(outputPath))} ${chalk.gray(`(${(stats.size / 1024).toFixed(0)}KB)`)}`);
    return outputPath;
  } catch (err) {
    log.warn("Instagram", `Failed to download/process: ${url}`);
    return null;
  }
}

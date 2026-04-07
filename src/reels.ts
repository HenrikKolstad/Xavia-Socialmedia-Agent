import chalk from "chalk";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { Property } from "./types";
import { generateReelCaption, generateHashtags } from "./content";
import { getRandomTopTrack } from "./spotify";
import { classifyImages, sortForReel } from "./image-classifier";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

const MAX_REEL_IMAGES = 24;

/**
 * Creates and posts an Instagram Reel for a property.
 * - Downloads images, fits to 9:16 with white padding (matching brand style)
 * - Creates a slideshow video with Ken Burns effect + crossfade transitions
 * - Overlays chill background music
 * - Posts as Instagram Reel via instagrapi
 */
export async function postReelToInstagram(
  property: Property,
  captionIndex: number = 0
): Promise<string | null> {
  const caption = await generateReelCaption(property);
  const hashtags = generateHashtags(property);
  log.info("Reel", `Creating reel for ${chalk.bold.yellowBright(property.id)}: ${chalk.cyanBright(property.title)}`);

  if (config.dryRun) {
    log.info("Reel", chalk.yellowBright("DRY RUN — would create and post reel with caption:"));
    console.log(chalk.white(caption));
    log.info("Reel", chalk.yellowBright("First comment hashtags:"));
    console.log(chalk.gray(hashtags));
    return `dry-run-reel-${property.id}`;
  }

  if (!config.instagram.username || !config.instagram.password) {
    log.error("Reel", "Missing Instagram credentials. Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env");
    return null;
  }

  if (property.imageUrls.length === 0) {
    log.error("Reel", `No images for property ${property.id}`);
    return null;
  }

  const tempDir = path.join(config.dataDir, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFiles: string[] = [];
  const videoPath = path.join(tempDir, `${property.id}_reel.mp4`);
  const thumbnailPath = path.join(tempDir, `${property.id}_thumb.jpg`);

  try {
    // Step 1: Classify images with vision AI and sort for best reel flow
    log.info("Reel", `Classifying ${chalk.bold.cyanBright(property.imageUrls.length.toString())} images with AI vision...`);
    const classified = await classifyImages(property.imageUrls.slice(0, MAX_REEL_IMAGES));
    const sortedUrls = sortForReel(classified);

    // Download and process sorted images (9:16 with white padding)
    for (let i = 0; i < sortedUrls.length; i++) {
      const imgPath = await downloadAndProcessReelImage(
        sortedUrls[i],
        path.join(tempDir, `${property.id}_reel_${i}.jpg`)
      );
      if (imgPath) tempFiles.push(imgPath);
    }

    if (tempFiles.length === 0) {
      log.error("Reel", `No images could be downloaded for ${property.id}`);
      return null;
    }

    // Create thumbnail from first image (4:5 for feed preview)
    await createThumbnail(tempFiles[0], thumbnailPath);

    // Step 2: Generate video with ffmpeg
    log.info("Reel", `Creating slideshow from ${chalk.bold.greenBright(tempFiles.length.toString())} images...`);

    const musicPath = path.join(__dirname, "..", "assets", "chill-bg.mp3");
    const createReelScript = path.join(__dirname, "..", "scripts", "create_reel.py");
    const pythonCmd = process.platform === "win32" ? "py" : "python3";

    const reelArgs = [
      createReelScript,
      "--images", ...tempFiles,
      "--output", videoPath,
      "--duration", "3",
      "--transition", "0.6",
    ];

    // Add music if available
    if (fs.existsSync(musicPath)) {
      reelArgs.push("--music", musicPath);
      log.info("Reel", `Using background music: ${chalk.cyanBright("chill-bg.mp3")}`);
    } else {
      log.warn("Reel", "No music file found at assets/chill-bg.mp3 — posting without music");
    }

    const { stdout: reelStdout, stderr: reelStderr } = await execFileAsync(pythonCmd, reelArgs, {
      timeout: 600000, // 10 min for video generation (up to 10 images)
    });

    if (reelStderr) {
      log.info("Reel", reelStderr.trim());
    }

    const reelResult = JSON.parse(reelStdout.trim());
    if (reelResult.error) {
      log.error("Reel", `Video creation failed: ${reelResult.error}`);
      return null;
    }

    log.success("Reel", `Video created: ${chalk.cyanBright(reelResult.duration + "s")} ${chalk.gray(`(${reelResult.size_mb}MB)`)}`);

    // Step 3: Pick music — check for manual override first, then auto Spotify
    let musicQuery = "";
    const musicOverrideFile = path.join(config.dataDir, "next-reel-music.txt");
    if (fs.existsSync(musicOverrideFile)) {
      musicQuery = fs.readFileSync(musicOverrideFile, "utf-8").trim();
      if (musicQuery) {
        log.info("Reel", `Using manual music: ${chalk.bold.cyanBright(musicQuery)}`);
        // Delete after use so next reel goes back to auto
        fs.unlinkSync(musicOverrideFile);
      }
    }
    if (!musicQuery) {
      try {
        const track = await getRandomTopTrack();
        if (track) {
          musicQuery = track.query;
          log.info("Reel", `Will search IG music for: ${chalk.bold.cyanBright(track.name)} by ${chalk.magentaBright(track.artist)}`);
        }
      } catch (err) {
        log.warn("Reel", "Could not fetch Spotify track — posting without music");
      }
    }

    // Step 4: Upload reel to Instagram
    log.info("Reel", `Uploading reel to ${chalk.magentaBright("Instagram")}...`);

    const igReelScript = path.join(__dirname, "..", "scripts", "ig_reel.py");
    const igArgs = [
      igReelScript,
      "--username", config.instagram.username,
      "--password", config.instagram.password,
      "--video", videoPath,
      "--caption", caption,
      "--hashtags", hashtags,
      "--session", path.join(config.dataDir, "ig_session.json"),
    ];

    if (musicQuery) {
      igArgs.push("--music-search", musicQuery);
    }

    if (fs.existsSync(thumbnailPath)) {
      igArgs.push("--thumbnail", thumbnailPath);
    }

    const { stdout, stderr } = await execFileAsync(pythonCmd, igArgs, {
      timeout: 180000, // 3 min for upload
    });

    if (stderr) {
      log.info("Reel", stderr.trim());
    }

    const result = JSON.parse(stdout.trim());

    if (result.error) {
      log.error("Reel", result.error);
      return null;
    }

    log.success("Reel", `Published reel: ${chalk.bold.greenBright(result.media_id)}`);
    return result.media_id;
  } catch (err: any) {
    // Show stderr from Python for better debugging
    if (err.stderr) {
      log.error("Reel", err.stderr.trim().split("\n").pop() || err.stderr.trim());
    }
    log.error("Reel", `Failed to create/post reel for ${property.id}: ${err.message || err}`);

    if (err.message?.includes("ENOENT") || err.message?.includes("not found")) {
      log.error("Reel", "Python or ffmpeg not found! Install:");
      console.log(chalk.yellowBright("  1. Python: https://www.python.org/downloads/"));
      console.log(chalk.yellowBright("  2. pip install instagrapi"));
      console.log(chalk.yellowBright("  3. ffmpeg: choco install ffmpeg  (or winget install ffmpeg)"));
    }

    return null;
  } finally {
    // Cleanup temp files
    for (const f of [...tempFiles, videoPath, thumbnailPath]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

/**
 * Downloads an image, converts to JPEG, fits within 9:16 ratio with white padding.
 * Same brand style as carousel posts but in vertical video format.
 */
async function downloadAndProcessReelImage(
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

    // Fit inside 9:16 ratio (1080x1920) with white padding — same brand look
    await sharp(Buffer.from(response.data))
      .resize(1080, 1920, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .jpeg({ quality: 95 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    log.info("Reel", `Image: ${chalk.cyanBright(path.basename(outputPath))} ${chalk.gray(`(${(stats.size / 1024).toFixed(0)}KB)`)}`);
    return outputPath;
  } catch (err) {
    log.warn("Reel", `Failed to download/process: ${url}`);
    return null;
  }
}

/**
 * Creates a thumbnail from the first image for the Reel feed preview.
 */
async function createThumbnail(sourcePath: string, outputPath: string): Promise<void> {
  try {
    await sharp(sourcePath)
      .resize(1080, 1350, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: 90 })
      .toFile(outputPath);
  } catch {
    // Non-critical — instagrapi will auto-generate if missing
  }
}

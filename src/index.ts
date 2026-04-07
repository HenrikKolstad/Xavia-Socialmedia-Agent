import chalk from "chalk";
import cron from "node-cron";
import { config } from "./config";
import { scrapeLatestProperties, scrapePropertyDetail } from "./scraper";
import { postToInstagram } from "./instagram";
import { postToTikTok } from "./tiktok";
import { isPropertyPosted, recordPost, getWatermark, setWatermark, getPropertyNum } from "./storage";
import { generateCaption } from "./content";
import { engageOnFeed } from "./engage";
import { Property } from "./types";
import { log } from "./logger";

const isDryRun = process.argv.includes("--dry-run") || config.dryRun;
const forcePropertyId = process.argv.find((a) => a.startsWith("--property="))?.split("=")[1] || "";
const MAX_POSTS_PER_DAY = config.maxPostsPerRun;

async function processNewProperties(): Promise<void> {
  log.blank();
  log.divider();
  log.header(`  🕐 Run started — ${new Date().toLocaleString()}`);
  log.header(`  📡 Mode: ${isDryRun ? chalk.yellowBright("DRY RUN") : chalk.greenBright("LIVE")}`);
  log.divider();
  log.blank();

  // Step 1: Scrape latest properties
  log.step(1, "Scraping new build properties...");
  const properties = await scrapeLatestProperties();

  if (properties.length === 0) {
    log.warn("Agent", "No properties found. Skipping.");
    return;
  }

  // Pick properties to post
  let toPost: Property[];
  if (forcePropertyId) {
    const forced = properties.find((p) => p.id === forcePropertyId);
    if (!forced) {
      log.error("Agent", `Property ${forcePropertyId} not found on site`);
      return;
    }
    log.info("Agent", `Forcing property: ${chalk.bold.yellowBright(forcePropertyId)}`);
    toPost = [forced];
  } else {
    // Filter: only properties NEWER than our watermark (never re-post old ones)
    const watermark = getWatermark();
    log.info("Agent", `Watermark: last posted property #${watermark}`);

    const newProperties = properties.filter((p) => {
      const num = getPropertyNum(p.url);
      // Must be newer than watermark AND not already in posted.json
      return num > watermark && !isPropertyPosted(p.id);
    });

    if (newProperties.length === 0) {
      log.info("Agent", "No new properties since last post. Running engagement only.");
      await runEngagement();
      return;
    }

    toPost = newProperties.slice(0, MAX_POSTS_PER_DAY);
    log.blank();
    log.success("Agent", `Found ${chalk.bold.yellowBright(newProperties.length.toString())} NEW properties (above watermark #${watermark}), posting ${chalk.bold.greenBright(toPost.length.toString())} (max ${MAX_POSTS_PER_DAY}/day):`);
    if (newProperties.length > MAX_POSTS_PER_DAY) {
      log.info("Agent", `${newProperties.length - MAX_POSTS_PER_DAY} more queued for tomorrow`);
    }
  }

  log.blank();
  toPost.forEach((p) => log.property(p.id, p.title, p.priceFormatted));
  log.blank();

  // Step 3: For each new property, enrich with detail page + post
  let postIndex = 0;
  for (const property of toPost) {
    log.divider();
    log.header(`  🏡 Processing: ${chalk.bold.yellowBright(property.id)} — ${chalk.cyanBright(property.title)}`);
    log.divider();

    // Enrich with images from detail page if needed
    if (property.imageUrls.length <= 1) {
      log.step(2, "Scraping detail page for images...");
      const detail = await scrapePropertyDetail(property.url);
      if (detail.imageUrls && detail.imageUrls.length > 0) {
        property.imageUrls = detail.imageUrls;
        log.success("Scraper", `Got ${chalk.bold.greenBright(detail.imageUrls.length.toString())} images`);
      }
    }

    if (property.imageUrls.length === 0) {
      log.warn("Agent", `Skipping ${property.id} — no images available`);
      continue;
    }

    // Post to Instagram
    let igPostId: string | null = null;
    try {
      log.step(3, `Posting to ${chalk.magentaBright("Instagram")}...`);
      igPostId = await postToInstagram(property, postIndex);
    } catch (err) {
      log.error("Instagram", `Post failed for ${property.id}: ${err}`);
    }
    await new Promise((r) => setTimeout(r, 2000));

    // Post to TikTok
    let ttPostId: string | null = null;
    await new Promise((r) => setTimeout(r, 2000));
    try {
      log.step(4, `Posting to ${chalk.cyanBright("TikTok")}...`);
      ttPostId = await postToTikTok(property);
    } catch (err) {
      log.error("TikTok", `Post failed for ${property.id}: ${err}`);
    }

    // Record the post + bump watermark
    const propNum = getPropertyNum(property.url);
    setWatermark(propNum);
    log.info("Agent", `Updated watermark to #${propNum}`);

    recordPost({
      propertyId: property.id,
      postedToInstagram: igPostId !== null,
      postedToTikTok: ttPostId !== null,
      postedToReels: false,
      instagramPostId: igPostId || undefined,
      tiktokPostId: ttPostId || undefined,
      postedAt: new Date().toISOString(),
      caption: await generateCaption(property, postIndex),
    });

    log.blank();
    console.log(
      chalk.bold.whiteBright(`  📊 Result: `) +
      log.platform("IG", igPostId !== null) +
      chalk.white(" | ") +
      log.platform("TT", ttPostId !== null)
    );
    log.blank();

    postIndex++;

    // Rate limit: random 45–90s delay between posts to look natural
    if (postIndex < toPost.length) {
      const delay = 45000 + Math.floor(Math.random() * 45000);
      log.info("Agent", `Waiting ${chalk.cyanBright(Math.round(delay / 1000) + "s")} before next post...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  log.blank();
  log.divider();
  log.success("Agent", "Batch complete! New property posted — skipping engagement today.");
  log.divider();
  log.blank();
}

async function runEngagement(): Promise<void> {
  log.blank();
  log.step(2, `Engaging with ${chalk.magentaBright("Instagram")} feed...`);
  try {
    const engagement = await engageOnFeed();
    if (engagement) {
      log.blank();
      console.log(
        chalk.bold.whiteBright("  💬 Engagement: ") +
        chalk.greenBright(`${engagement.liked} liked`) +
        chalk.white(" | ") +
        chalk.greenBright(`${engagement.commented} commented`)
      );
    }
  } catch (err) {
    log.error("Engage", `Feed engagement failed: ${err}`);
  }
  log.blank();
  log.divider();
  log.success("Agent", "Engagement complete!");
  log.divider();
  log.blank();
}

async function main(): Promise<void> {
  console.log();
  console.log(chalk.bold.magentaBright("  ╔══════════════════════════════════════════╗"));
  console.log(chalk.bold.magentaBright("  ║") + chalk.bold.yellowBright("   🏠 Xavia Agent 007                    ") + chalk.bold.magentaBright("║"));
  console.log(chalk.bold.magentaBright("  ║") + chalk.bold.cyanBright("   Real Estate Social Poster              ") + chalk.bold.magentaBright("║"));
  console.log(chalk.bold.magentaBright("  ╚══════════════════════════════════════════╝"));
  console.log();
  console.log(chalk.blueBright("  🌐 Base URL : ") + chalk.whiteBright(config.baseUrl));
  console.log(chalk.blueBright("  ⏰ Schedule : ") + chalk.whiteBright(config.cronSchedule) + chalk.gray(` (${config.cronTimezone})`));
  console.log(chalk.blueBright("  🧪 Dry Run  : ") + (isDryRun ? chalk.yellowBright("YES") : chalk.greenBright("NO")));
  console.log(chalk.blueBright("  📸 IG User  : ") + chalk.magentaBright(config.instagram.username ? "@" + config.instagram.username : "NOT SET"));
  console.log(chalk.blueBright("  🎬 TT Token : ") + (config.tiktok.accessToken ? chalk.greenBright("set") : chalk.redBright("NOT SET")));
  console.log();
  log.divider();
  console.log();

  if (isDryRun) {
    config.dryRun = true;
  }

  const isScheduledRun = process.argv.includes("--scheduled");
  const isNowAndSchedule = process.argv.includes("--now-and-schedule");

  if (isNowAndSchedule) {
    log.info("Agent", chalk.bold.greenBright("Posting 1 property now, then scheduling tomorrow..."));
    console.log();

    await processNewProperties();

    const [cronMin, cronHour] = config.cronSchedule.split(" ");
    const nextTime = `${cronHour.padStart(2, "0")}:${cronMin.padStart(2, "0")}`;
    console.log();
    log.info("Agent", `Next post scheduled for tomorrow at ${chalk.cyanBright(nextTime)} (${config.cronTimezone})`);
    console.log(chalk.bold.greenBright(`  🟢 Agent waiting for ${nextTime} tomorrow. Press Ctrl+C to stop.`));
    console.log();

    cron.schedule(config.cronSchedule, async () => {
      try {
        await processNewProperties();
      } catch (err) {
        log.error("Agent", `Scheduled run failed: ${err}`);
      }
      log.info("Agent", chalk.bold.greenBright("Done! Tomorrow's post complete. Exiting."));
      process.exit(0);
    }, { timezone: config.cronTimezone });
  } else if (isScheduledRun) {
    log.info("Agent", `Waiting for scheduled run at cron: ${chalk.cyanBright(config.cronSchedule)} (${config.cronTimezone})`);
    console.log();
    const [cronMin, cronHour] = config.cronSchedule.split(" ");
    const nextTime = `${cronHour.padStart(2, "0")}:${cronMin.padStart(2, "0")}`;
    console.log(chalk.bold.greenBright(`  🟢 Agent waiting for ${nextTime}. Will post 1 then exit.`));
    console.log();

    cron.schedule(config.cronSchedule, async () => {
      try {
        await processNewProperties();
      } catch (err) {
        log.error("Agent", `Scheduled run failed: ${err}`);
      }
      log.info("Agent", chalk.bold.greenBright("Done! Post complete. Exiting."));
      process.exit(0);
    }, { timezone: config.cronTimezone });
  } else if (process.argv.includes("--once")) {
    await processNewProperties();
  } else {
    await processNewProperties();

    log.info("Agent", `Scheduling next runs with cron: ${chalk.cyanBright(config.cronSchedule)}`);
    cron.schedule(config.cronSchedule, () => {
      processNewProperties().catch((err) =>
        log.error("Agent", `Scheduled run failed: ${err}`)
      );
    }, { timezone: config.cronTimezone });
    console.log();
    console.log(chalk.bold.greenBright("  🟢 Agent is running. Press Ctrl+C to stop."));
    console.log();
  }
}

main().catch((err) => {
  log.error("Agent", `Fatal error: ${err}`);
  process.exit(1);
});

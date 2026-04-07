import chalk from "chalk";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { config } from "./config";
import { log } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Run a single engagement session — likes + comments on real posts.
 */
async function runEngageSession(likes: number, comments: number, follows?: { from: string; count: number }): Promise<{
  liked: number;
  commented: number;
  followed: number;
} | null> {
  if (!config.instagram.username || !config.instagram.password) {
    log.warn("Engage", "Missing Instagram credentials. Skipping engagement.");
    return null;
  }

  const scriptPath = path.join(__dirname, "..", "scripts", "ig_engage.py");
  const args = [
    scriptPath,
    "--username", config.instagram.username,
    "--password", config.instagram.password,
    "--session", path.join(config.dataDir, "ig_session.json"),
    "--likes", String(likes),
    "--comments", String(comments),
    ...(follows ? ["--follow-from", follows.from, "--follows", String(follows.count)] : []),
  ];

  const pythonCmd = process.platform === "win32" ? "py" : "python3";

  try {
    const { stdout, stderr } = await execFileAsync(pythonCmd, args, {
      timeout: 300000,
    });

    if (stderr) {
      stderr.trim().split("\n").forEach((line) => {
        log.info("Engage", line.replace(/^\[IG-Engage\]\s*/, ""));
      });
    }

    const result = JSON.parse(stdout.trim());

    if (result.error) {
      log.error("Engage", result.error);
      return null;
    }

    return { liked: result.liked_count, commented: result.commented_count, followed: result.followed_count || 0 };
  } catch (err: any) {
    log.error("Engage", `Session failed: ${err.message || err}`);
    return null;
  }
}

/**
 * Engages with the Instagram feed — ~60 likes spread across 4 sessions
 * throughout the day to look human. Comments stay moderate at 2-4 per session.
 *
 * Schedule: runs at ~10 AM, 1 PM, 5 PM, 8 PM (with random ±30 min jitter).
 */
export async function engageOnFeed(): Promise<{
  liked: number;
  commented: number;
} | null> {
  // Rest day: pick a consistent "off day" each week based on the week number
  // so it's the same day all week but different week to week
  const now = new Date();
  const weekNum = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
  const restDay = weekNum % 7; // 0=Sun, 1=Mon, ... 6=Sat
  if (now.getDay() === restDay) {
    log.info("Engage", chalk.yellowBright(`Rest day today (${now.toLocaleDateString("en", { weekday: "long" })}) — skipping engagement to stay under the radar`));
    return { liked: 0, commented: 0 };
  }

  const FOLLOW_SOURCE = "DULYINVESTMENT";

  // 3-5 sessions randomly spread across ~12 hours
  const sessionCount = Math.floor(Math.random() * 3) + 3;
  const totalLikes = 60;
  const totalComments = Math.floor(Math.random() * 5) + 8; // 8-12
  const totalFollows = Math.floor(Math.random() * 5) + 18; // 18-22

  // Distribute across sessions
  let remainingLikes = totalLikes;
  let remainingComments = totalComments;
  let remainingFollows = totalFollows;
  const sessions: { likes: number; comments: number; follows: number }[] = [];
  for (let i = 0; i < sessionCount; i++) {
    const isLast = i === sessionCount - 1;
    const likes = isLast ? remainingLikes : Math.floor(Math.random() * 8) + 8;
    const comments = isLast ? remainingComments : Math.floor(Math.random() * 3) + 1;
    const follows = isLast ? remainingFollows : Math.floor(Math.random() * 4) + 2; // 2-5 per session
    sessions.push({
      likes: Math.min(likes, remainingLikes),
      comments: Math.min(comments, remainingComments),
      follows: Math.min(follows, remainingFollows),
    });
    remainingLikes -= sessions[i].likes;
    remainingComments -= sessions[i].comments;
    remainingFollows -= sessions[i].follows;
  }

  log.info("Engage", `Scheduling ${chalk.magentaBright(`${sessionCount} sessions`)} — ~${totalLikes} likes, ~${totalComments} comments, ~${totalFollows} follows from @${FOLLOW_SOURCE}`);

  if (config.dryRun) {
    log.info("Engage", chalk.yellowBright(`DRY RUN — would spread ~${totalLikes} likes + ~${totalComments} comments + ~${totalFollows} follows across ${sessionCount} sessions`));
    return { liked: totalLikes, commented: totalComments };
  }

  let totalLiked = 0;
  let totalCommented = 0;
  let totalFollowed = 0;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const baseDelayH = i === 0 ? 1 + Math.random() : 1.5 + Math.random() * 2;
    const delayMs = baseDelayH * 60 * 60 * 1000;

    const delayMin = Math.round(delayMs / 60000);
    log.info("Engage", `Session ${i + 1}/${sessions.length} in ~${delayMin} min (${session.likes} likes, ${session.comments} comments, ${session.follows} follows)`);

    await new Promise((r) => setTimeout(r, delayMs));

    log.step(6, `Session ${i + 1}/${sessions.length} — ${chalk.magentaBright(`${session.likes} likes + ${session.comments} comments + ${session.follows} follows`)}`);
    const result = await runEngageSession(
      session.likes,
      session.comments,
      session.follows > 0 ? { from: FOLLOW_SOURCE, count: session.follows } : undefined,
    );

    if (result) {
      totalLiked += result.liked;
      totalCommented += result.commented;
      totalFollowed += result.followed;
      log.success("Engage", `Session ${i + 1} done: ${chalk.greenBright(`${result.liked} liked, ${result.commented} commented, ${result.followed} followed`)}`);
    }
  }

  log.success("Engage", `Day total: ${chalk.bold.greenBright(String(totalLiked))} liked, ${chalk.bold.greenBright(String(totalCommented))} commented, ${chalk.bold.greenBright(String(totalFollowed))} followed`);
  return { liked: totalLiked, commented: totalCommented };
}

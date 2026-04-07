import dotenv from "dotenv";
dotenv.config();

export const config = {
  instagram: {
    username: process.env.INSTAGRAM_USERNAME || "",
    password: process.env.INSTAGRAM_PASSWORD || "",
  },
  tiktok: {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || "",
  },
  cronSchedule: process.env.CRON_SCHEDULE || "0 8 * * *",
  cronTimezone: process.env.CRON_TIMEZONE || "Europe/Oslo",
  maxPostsPerRun: 1,
  dryRun: process.env.DRY_RUN === "true",
  baseUrl: process.env.XAVIA_BASE_URL || "https://www.xaviaestate.com",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  dataDir: "./data",
  postedFile: "./data/posted.json",
};

import chalk from "chalk";

// Force colors on Windows cmd
chalk.level = 3;

// Bright, colorful logging for Xavia Agent 007

export const log = {
  banner: (text: string) =>
    console.log(chalk.bold.magentaBright(text)),

  header: (text: string) =>
    console.log(chalk.bold.cyanBright(text)),

  info: (tag: string, msg: string) =>
    console.log(chalk.blueBright(`[${tag}]`) + " " + chalk.white(msg)),

  success: (tag: string, msg: string) =>
    console.log(chalk.greenBright(`[${tag}] ✓`) + " " + chalk.whiteBright(msg)),

  warn: (tag: string, msg: string) =>
    console.log(chalk.yellowBright(`[${tag}] ⚠`) + " " + chalk.yellow(msg)),

  error: (tag: string, msg: string) =>
    console.log(chalk.redBright(`[${tag}] ✗`) + " " + chalk.red(msg)),

  property: (id: string, title: string, price: string) =>
    console.log(
      chalk.magentaBright("  🏠 ") +
      chalk.bold.yellowBright(id) +
      chalk.white(": ") +
      chalk.cyanBright(title) +
      chalk.greenBright(` (${price})`)
    ),

  step: (num: number, text: string) =>
    console.log(
      chalk.bold.magentaBright(`  [${num}]`) + " " + chalk.whiteBright(text)
    ),

  platform: (name: string, success: boolean) =>
    success
      ? chalk.greenBright(`${name}: ✓`)
      : chalk.redBright(`${name}: ✗`),

  divider: () =>
    console.log(chalk.magentaBright("━".repeat(50))),

  blank: () => console.log(),
};

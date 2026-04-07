import Anthropic from "@anthropic-ai/sdk";
import { Property } from "./types";
import { config } from "./config";

/**
 * Professional captions matching XaviaEstate brand style.
 * Proper capitalization, vacation emojis, clean layout.
 */

/** Opening lines — every post highlights "New Build" */
const OPENERS = [
  (p: Property) => `☀️ New Build ${p.propertyType} — ${loc(p)} 🌊`,
  (p: Property) => `🌴 New Build ${p.propertyType} in ${loc(p)} 🌊`,
  (p: Property) => `🏖️ New Build Just Listed — ${loc(p)} ☀️`,
  (p: Property) => `☀️ New Build in ${loc(p)} — Just Released 🌴`,
  (p: Property) => `🌅 New Build ${p.propertyType} — ${loc(p)} 🏖️`,
  (p: Property) => `🏡 New Build ${p.propertyType} in ${loc(p)} ☀️`,
  (p: Property) => `✨ New Build — ${loc(p)} 🌊`,
  (p: Property) => `🇪🇸 New Build ${p.propertyType} — ${loc(p)} 🌴`,
];

/**
 * Generate a brief AI description for a property.
 * Each property gets a unique, natural-sounding closer.
 */
async function generateAIDescription(p: Property): Promise<string> {
  if (!config.anthropicApiKey) {
    // Fallback if no API key configured
    return `New build ${p.propertyType.toLowerCase()} in ${loc(p)}. ☀️`;
  }

  try {
    const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

    const prompt = [
      `Write a single short, warm sentence (max 20 words) describing this property for an Instagram post.`,
      `Property: ${p.propertyType} in ${p.location}, Spain.`,
      p.bedrooms ? `${p.bedrooms} bedrooms.` : "",
      p.bathrooms ? `${p.bathrooms} bathrooms.` : "",
      p.sizeInterior ? `${p.sizeInterior}m² interior.` : "",
      p.sizePlot ? `${p.sizePlot}m² plot.` : "",
      `Price: ${p.priceFormatted}.`,
      `Be friendly and inviting. Use one emoji at the end. Do not mention the price. Do not use hashtags.`,
    ].filter(Boolean).join(" ");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (text) return text;
  } catch (err: any) {
    console.warn(`[Content] ⚠️  AI description failed: ${err.message || err}`);
  }

  // Fallback
  return `New build ${p.propertyType.toLowerCase()} in ${loc(p)}. ☀️`;
}

/** Generate .com link for the property */
function propertyLink(p: Property): string {
  // Convert URL to use .com domain
  return p.url.replace("https://www.", "").replace("http://www.", "").replace("http://", "").replace("https://", "");
}

/** Properly capitalize location name */
function loc(p: Property): string {
  return p.location
    .split(/[\s,]+/)
    .map((word) => {
      const lower = word.toLowerCase();
      // Keep small words lowercase unless first
      if (["de", "del", "la", "el", "en", "las", "los", "y"].includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\s,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** Max reasonable sizes (m²) per property type — anything above is likely a scraping error */
const SIZE_LIMITS: Record<string, { interior: number; plot: number }> = {
  apartment:  { interior: 300,  plot: 100   },
  penthouse:  { interior: 400,  plot: 200   },
  studio:     { interior: 80,   plot: 50    },
  bungalow:   { interior: 250,  plot: 1500  },
  townhouse:  { interior: 400,  plot: 500   },
  duplex:     { interior: 400,  plot: 500   },
  villa:      { interior: 1500, plot: 15000 },
};
const DEFAULT_LIMITS = { interior: 800, plot: 5000 };

/** Return value only if it's within reasonable range for the property type, else null */
function validSize(value: number | null, type: string, field: "interior" | "plot"): number | null {
  if (!value || value <= 0) return null;
  const limits = SIZE_LIMITS[type.toLowerCase()] ?? DEFAULT_LIMITS;
  const max = field === "interior" ? limits.interior : limits.plot;
  if (value > max) {
    console.warn(`[Content] ⚠️  Dropped suspicious ${field} size ${value}m² for ${type} (max ${max}m²)`);
    return null;
  }
  return value;
}

/** Feature bullet points */
function features(p: Property): string {
  const lines: string[] = [];
  if (p.bedrooms) lines.push(`☀️ ${p.bedrooms} Bedrooms`);
  if (p.bathrooms) lines.push(`☀️ ${p.bathrooms} Bathrooms`);

  const interior = validSize(p.sizeInterior, p.propertyType, "interior");
  const plot = validSize(p.sizePlot, p.propertyType, "plot");
  if (interior) lines.push(`☀️ ${interior}m² Living Space`);
  if (plot) lines.push(`☀️ ${plot}m² Plot`);

  const type = p.propertyType.toLowerCase();
  if (type === "villa") {
    lines.push("☀️ Private Pool");
    lines.push("☀️ Terrace with Views");
  }
  if (type === "penthouse") {
    lines.push("☀️ Rooftop Solarium");
    lines.push("☀️ Panoramic Sea Views");
  }
  if (type === "apartment") {
    lines.push("☀️ Communal Pool");
    lines.push("☀️ Modern Finishes");
  }

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/** Simple hash to get a stable number from a string */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Generates a unique, human-like description for each property.
 * Combines property-specific details (type, size, bedrooms, location)
 * with warm lifestyle language so no two posts read the same.
 */
function vibeText(p: Property): string {
  const l = p.location.toLowerCase();
  const type = p.propertyType.toLowerCase();
  const seed = simpleHash(p.id + p.location);

  // Property-specific personal touches based on what the property actually offers
  const personalDetails: string[] = [];

  if (type === "villa" && p.sizePlot && p.sizePlot > 300) {
    personalDetails.push("Plenty of outdoor space for barbecues, a pool, and lazy Sunday mornings in the garden.");
  } else if (type === "villa") {
    personalDetails.push("Your own private retreat with room to breathe and space to enjoy life.");
  }

  if (type === "penthouse") {
    personalDetails.push("Top-floor living with wraparound views — the kind of place that makes you stop and stare.");
  }

  if (type === "apartment" && p.bedrooms && p.bedrooms >= 3) {
    personalDetails.push("Spacious enough for the whole family, with that easy lock-up-and-go lifestyle.");
  } else if (type === "apartment") {
    personalDetails.push("Low-maintenance living with everything you need right on your doorstep.");
  }

  if (type === "bungalow") {
    personalDetails.push("Single-level living done right — no stairs, no fuss, just comfort.");
  }

  if (type === "townhouse" || type === "town house") {
    personalDetails.push("Spread across multiple levels with a lovely sense of space and privacy.");
  }

  if (type === "duplex") {
    personalDetails.push("Two floors of well-designed space — perfect for separating living and sleeping areas.");
  }

  if (p.sizeInterior && p.sizeInterior > 150) {
    personalDetails.push("Generous interiors with room for everyone to have their own corner.");
  }

  // Location-flavoured description
  let locationVibe: string;

  if (
    l.includes("torrevieja") || l.includes("calpe") ||
    l.includes("jávea") || l.includes("javea") ||
    l.includes("villajoyosa") || l.includes("lo pagan") ||
    l.includes("campoamor") || l.includes("guardamar") ||
    l.includes("manga")
  ) {
    const coastal = [
      `Right by the sea in ${loc(p)} — mornings start with salt air and end with golden sunsets.`,
      `You can practically hear the waves from here. ${loc(p)} at its absolute best.`,
      `Beach life meets modern comfort in ${loc(p)}. This is the kind of place you come back to and never leave.`,
      `${loc(p)} — where the Mediterranean is your backyard and every day feels like a holiday.`,
      `Walking distance to the beach in ${loc(p)}. The kind of spot that just feels right.`,
    ];
    locationVibe = coastal[seed % coastal.length];
  } else if (
    l.includes("golf") || l.includes("vistabella") ||
    l.includes("marquesa") || l.includes("quesada") ||
    l.includes("rojales")
  ) {
    const golf = [
      `Nestled in the heart of ${loc(p)}'s golf country — fairways, sunshine, and a cold drink on the terrace.`,
      `Resort-style living in ${loc(p)}, with golf on your doorstep and the beach just a short drive away.`,
      `${loc(p)} — lush greens, warm winters, and a community that knows how to live well.`,
      `Wake up, hit the course, lunch by the pool. That's a normal Tuesday in ${loc(p)}.`,
    ];
    locationVibe = golf[seed % golf.length];
  } else if (l.includes("murcia") || l.includes("san javier") || l.includes("san miguel")) {
    const murcia = [
      `${loc(p)} — tucked between two seas, with sunshine pretty much every day of the year.`,
      `One of southern Spain's best-kept secrets. ${loc(p)} has it all: coast, culture, and incredible food.`,
      `Real Spanish living in ${loc(p)}, where the locals welcome you and the sun never stops shining.`,
    ];
    locationVibe = murcia[seed % murcia.length];
  } else if (
    l.includes("mutxamel") || l.includes("finestrat") ||
    l.includes("daya") || l.includes("polop")
  ) {
    const hillside = [
      `Peaceful hillside living in ${loc(p)}, with mountain views and the coast just minutes away.`,
      `${loc(p)} — fresh air, open skies, and all the charm of the Spanish countryside.`,
      `Quiet mornings, starry nights, and the best of the Costa Blanca right at your feet. That's ${loc(p)}.`,
    ];
    locationVibe = hillside[seed % hillside.length];
  } else {
    const general = [
      `A fresh start in ${loc(p)} — modern design, warm climate, and a pace of life that just makes sense.`,
      `${loc(p)} offers over 300 days of sunshine, world-class beaches, and a lifestyle worth waking up for.`,
      `Built for the way you actually want to live. ${loc(p)} is calling.`,
      `Sun, space, and a home that feels like it was made for you — right here in ${loc(p)}.`,
    ];
    locationVibe = general[seed % general.length];
  }

  // Combine: location vibe + one personal detail (if available)
  const detail = personalDetails.length > 0
    ? personalDetails[seed % personalDetails.length]
    : "";

  return detail ? `${locationVibe}\n\n${detail}` : locationVibe;
}

/**
 * Hashtags for first comment.
 * Max 8 hashtags (Instagram algorithm favours fewer, targeted tags).
 * Always includes #NybyggSpania, #InvestereSpania, #SpaniaEiendom.
 */
const REQUIRED_HASHTAGS = ["#NybyggSpania", "#InvestereSpania", "#SpaniaEiendom"];
const MAX_HASHTAGS = 8;

export function generateHashtags(p: Property): string {
  // Start with required tags
  const tags: string[] = [...REQUIRED_HASHTAGS];

  const l = p.location.toLowerCase();
  const city = p.location.split(",")[0].trim().replace(/\s+/g, "");

  // Location-specific tags (highest relevance)
  const locationTags: string[] = [`#${city}`];
  if (l.includes("torrevieja")) locationTags.push("#Torrevieja");
  else if (l.includes("calpe")) locationTags.push("#Calpe");
  else if (l.includes("jávea") || l.includes("javea")) locationTags.push("#Javea");
  else if (l.includes("rojales") || l.includes("quesada")) locationTags.push("#CiudadQuesada");
  else if (l.includes("manga")) locationTags.push("#LaManga");
  else if (l.includes("murcia")) locationTags.push("#Murcia");
  else if (l.includes("alicante")) locationTags.push("#CostaBlanca");
  if (l.includes("golf") || l.includes("marquesa") || l.includes("vistabella")) locationTags.push("#GolfProperty");

  // General brand/reach tags (fill remaining slots)
  const generalTags = ["#XaviaEstate", "#NewBuildSpain", "#SpanishProperty", "#CostaBlanca"];

  // Combine: required first, then location, then general — capped at MAX_HASHTAGS
  for (const t of [...locationTags, ...generalTags]) {
    if (!tags.includes(t) && tags.length < MAX_HASHTAGS) {
      tags.push(t);
    }
  }

  return tags.join(" ");
}

export async function generateCaption(property: Property, _index: number = 0): Promise<string> {
  // Use date + property ID to rotate openers — guarantees variety across posts
  const today = new Date().toISOString().slice(0, 10);
  const seed = simpleHash(today + property.id);
  const opener = OPENERS[seed % OPENERS.length];

  // AI-generated brief description unique to this property
  const aiDescription = await generateAIDescription(property);

  return (
    `${opener(property)}\n\n` +
    features(property) +
    `\n${aiDescription}\n\n` +
    `DM for details.\n\n` +
    `🔗 ${propertyLink(property)}`
  );
}

/**
 * Generate a clean Reel caption.
 * Title + short description + hashtags for English-speaking Spain audience.
 */
export async function generateReelCaption(property: Property): Promise<string> {
  const location = loc(property);
  const city = location.split(",")[0].trim();
  const type = property.propertyType || "Property";

  // Clean title
  const title = `${type} in ${city}, Spain`;

  // Short description
  const details: string[] = [];
  if (property.bedrooms) details.push(`${property.bedrooms} bed`);
  if (property.bathrooms) details.push(`${property.bathrooms} bath`);
  if (property.sizeInterior) details.push(`${property.sizeInterior}m²`);
  const desc = details.length > 0 ? details.join(" · ") : "New build";

  const reelTags = generateReelHashtags(property);

  return `📍 ${title}\n${desc}\n\n${reelTags}`;
}

/**
 * Hashtags for Reels — English audience interested in Spain property.
 * Max 15 targeted tags.
 */
function generateReelHashtags(p: Property): string {
  const city = loc(p).split(",")[0].trim().replace(/\s+/g, "");

  // Always include
  const fixed: string[] = [
    `#${city}`,
    "#SpainProperty",
    "#NewBuildSpain",
    "#XaviaEstate",
  ];

  // Pool of rotating tags — English/international audience
  const pool: string[] = [
    "#RealEstateSpain",
    "#CostaBlanca",
    "#PropertyInvestment",
    "#DreamHome",
    "#MediterraneanLiving",
    "#ExpatLife",
    "#MoveToSpain",
    "#LuxuryHomes",
    "#InvestInSpain",
    "#SpanishProperty",
    "#HouseHunting",
    "#NewBuild",
    "#PropertyTour",
    "#SunnySpain",
    "#HomeAbroad",
  ];

  // Shuffle pool and pick enough to reach 12-15 total
  const seed = simpleHash(new Date().toISOString().slice(0, 10) + p.id);
  const shuffled = pool
    .map((tag, i) => ({ tag, sort: (seed * (i + 1) * 7) % 1000 }))
    .sort((a, b) => a.sort - b.sort)
    .map((t) => t.tag);

  const count = 12 + (seed % 4); // 12 to 15 total
  const tags = [...fixed];
  for (const t of shuffled) {
    if (tags.length >= count) break;
    if (!tags.includes(t)) tags.push(t);
  }

  return tags.join(" ");
}

export function generateTikTokCaption(property: Property): string {
  const location = loc(property);
  const city = location.split(",")[0].trim();

  const hooks = [
    `POV: Your new ${property.propertyType.toLowerCase()} in ${city} 🇪🇸☀️`,
    `This ${property.propertyType.toLowerCase()} in ${city} 🌊🏖️`,
    `Would you move to ${city} for this? 🌴☀️`,
    `Wait till you see inside... 🏡🌅`,
    `${city}, Spain. Thoughts? 🌊☀️`,
  ];

  const hook = hooks[Math.floor(Math.random() * hooks.length)];
  const cityTag = city.replace(/\s+/g, "");
  const ttTags = [
    "#XaviaEstate", `#${cityTag}`, "#SpainProperty", "#LivingInSpain",
    "#CostaBlanca", "#MoveToSpain", "#DreamHome", "#PropertyTok",
    "#HouseTour", "#ExpatLife", "#MediterraneanLife",
  ];

  return `${hook}\n\n${vibeText(property)}\n\n${ttTags.join(" ")}`;
}

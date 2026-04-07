"""
Scrapes property listings from XaviaEstate.com using cloudscraper
to bypass the JavaScript challenge page.

Usage: python3 scrape_listings.py [url]
Default URL: https://www.xaviaestate.com/en
Returns JSON array of property objects.
"""
import sys
import json
import re

def scrape_listings(url: str) -> list[dict]:
    import cloudscraper
    import time

    html = ""
    # Retry up to 3 times — cloudscraper sometimes gets the challenge page
    for attempt in range(3):
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True}
        )
        resp = scraper.get(url, timeout=30)

        if resp.status_code != 200:
            print(f"[Scraper] HTTP {resp.status_code} (attempt {attempt + 1})", file=sys.stderr)
            time.sleep(2)
            continue

        if "One moment" in resp.text or len(resp.text) < 20000:
            print(f"[Scraper] Got challenge page (attempt {attempt + 1}), retrying...", file=sys.stderr)
            time.sleep(2)
            continue

        html = resp.text
        break

    if not html:
        print("[Scraper] Failed to bypass challenge after 3 attempts", file=sys.stderr)
        return []
    properties = []
    seen = set()

    # Find all property links (absolute URLs)
    # Pattern: href="https://www.xaviaestate.com/en/property/ID/slug-XEREF"
    link_pattern = re.compile(
        r'href="(https?://www\.xaviaestate\.com/en/property/(\d+)/([^"]+))"',
        re.IGNORECASE
    )

    for match in link_pattern.finditer(html):
        prop_url = match.group(1)
        prop_id_num = match.group(2)
        slug = match.group(3)

        # Extract XE reference
        ref_match = re.search(r'(XE\w+)', slug, re.IGNORECASE)
        ref = ref_match.group(1) if ref_match else ""
        if not ref or ref in seen:
            continue
        seen.add(ref)

        # Parse slug for type and location
        slug_clean = slug.replace("-", " ")
        prop_type = extract_type(slug_clean)
        location = extract_location(slug_clean)

        # Find context around this link for price/specs
        # Look for the featDetailCont block containing this property
        context = find_property_context(html, prop_url)

        price = 0
        price_formatted = ""
        bedrooms = 0
        bathrooms = 0
        size_interior = 0
        size_plot = 0
        image_url = ""

        if context:
            # Extract price: €&nbsp;750,000 or €750,000
            price_match = re.search(r'€[&nbsp;\s]*?([\d,.\s]+)', context)
            if price_match:
                price_str = re.sub(r'[^\d]', '', price_match.group(1))
                price = int(price_str) if price_str else 0
                price_formatted = format_price(price)

            # Extract specs from featData spans
            feat_data = re.findall(r'<span class="featData">(.*?)</span>', context)
            specs = parse_specs(feat_data, context)
            bedrooms = specs.get("bedrooms", 0)
            bathrooms = specs.get("bathrooms", 0)
            size_interior = specs.get("size_interior", 0)
            size_plot = specs.get("size_plot", 0)

            # Extract background image
            bg_match = re.search(r"background-image:\s*url\('([^']+)'\)", context)
            if bg_match:
                image_url = bg_match.group(1)

            # Extract location from gridTown if available
            town_match = re.search(r'<span class="gridTown">(.*?)</span>', context)
            if town_match:
                location = town_match.group(1).strip()

            # Extract type from gridType if available
            type_match = re.search(r'<span class="gridType">(.*?)</span>', context)
            if type_match:
                prop_type = type_match.group(1).strip()

        title = f"{prop_type} in {location}" if location else prop_type

        properties.append({
            "id": ref,
            "title": title,
            "price": price,
            "priceFormatted": price_formatted or format_price(price),
            "location": location,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "sizeInterior": size_interior,
            "sizePlot": size_plot,
            "propertyType": prop_type,
            "url": prop_url,
            "imageUrls": [image_url] if image_url else [],
        })

    return properties


def find_property_context(html: str, prop_url: str) -> str:
    """Find the featDetailCont block containing a property link."""
    idx = html.find(prop_url)
    if idx == -1:
        return ""

    # Search backwards for the start of the featDetailCont div
    search_start = max(0, idx - 3000)
    prefix = html[search_start:idx]
    feat_idx = prefix.rfind('featDetailCont')
    if feat_idx != -1:
        block_start = search_start + feat_idx
    else:
        block_start = max(0, idx - 500)

    # Search forward for the next featDetailCont (end of this block)
    search_end = min(len(html), idx + 3000)
    suffix = html[idx:search_end]
    next_feat = suffix.find('featDetailCont', 100)
    if next_feat != -1:
        block_end = idx + next_feat
    else:
        block_end = min(len(html), idx + 2000)

    return html[block_start:block_end]


def parse_numeric_value(raw: str, is_size: bool = False) -> int:
    """Parse a numeric value from HTML, handling European decimal format.

    European format uses comma as decimal separator: '111,0' means 111.0
    The website often shows sizes like '111,0 m²' or '500,0'.
    Always handles European decimals — safe for beds/baths too (e.g. "3" → 3).
    """
    if not raw:
        return 0
    text = raw.strip()

    # Remove HTML entities like &sup2; BEFORE stripping non-numeric chars
    # (the "2" in &sup2; would otherwise be kept as a digit)
    text = re.sub(r'&\w+;', '', text)
    # Remove m² unit and any surrounding whitespace
    text = re.sub(r'm²', '', text)

    # Remove spaces, and other non-numeric chars except , and .
    text = re.sub(r'[^\d,.]', '', text)
    if not text:
        return 0

    # European format: "1.234,5" → thousands sep is '.', decimal is ','
    if ',' in text and '.' in text:
        # "1.234,56" → remove thousands sep, convert decimal
        text = text.replace('.', '').replace(',', '.')
    elif ',' in text:
        # "111,0" → comma is decimal separator
        text = text.replace(',', '.')
    # else: "1234" or "111.0" — already fine

    try:
        return round(float(text))
    except ValueError:
        return 0


def parse_specs(feat_data: list, context: str) -> dict:
    """Parse specs from filterResIcon blocks.

    Match each icon div together with its featData span as a single unit
    so values never get misaligned when extra spans exist in the HTML.
    """
    result = {"bedrooms": 0, "bathrooms": 0, "size_interior": 0, "size_plot": 0}

    # Match the full block: icon class + icon name + value span in one regex
    block_pattern = re.compile(
        r'<div class="filterResIcon\s*(\w*)">\s*'
        r'<i class="fa fa-(\S+)"[^>]*></i>\s*'
        r'<span class="featData">(.*?)</span>',
        re.DOTALL
    )

    for m in block_pattern.finditer(context):
        cls = m.group(1)   # e.g. "buildSize", "plotSize", ""
        icon = m.group(2)  # e.g. "fa-home", "fa-expand", "fa-bed"
        raw = m.group(3)   # e.g. "111,0", "3"

        is_size = ("buildSize" in cls or icon == "fa-home" or
                   "plotSize" in cls or "expand" in icon)
        val = parse_numeric_value(raw, is_size=is_size)

        if "buildSize" in cls or icon == "fa-home":
            if result["size_interior"] == 0:
                result["size_interior"] = val
        elif "plotSize" in cls or "expand" in icon:
            result["size_plot"] = val
        elif "bed" in icon:
            result["bedrooms"] = val
        elif "bath" in icon:
            result["bathrooms"] = val

    # Fallback: if the unified regex didn't match (HTML structure varies),
    # use the old separate-list approach but only if we got nothing above
    if all(v == 0 for v in result.values()) and feat_data:
        icon_data = re.findall(
            r'<div class="filterResIcon\s*(\w*)">\s*<i class="fa fa-(\S+)',
            context
        )
        for i, (cls2, icon2) in enumerate(icon_data):
            if i < len(feat_data):
                is_sz = ("buildSize" in cls2 or icon2 == "fa-home" or
                         "plotSize" in cls2 or "expand" in icon2)
                v = parse_numeric_value(feat_data[i], is_size=is_sz)
                if "buildSize" in cls2 or icon2 == "fa-home":
                    if result["size_interior"] == 0:
                        result["size_interior"] = v
                elif "plotSize" in cls2 or "expand" in icon2:
                    result["size_plot"] = v
                elif "bed" in icon2:
                    result["bedrooms"] = v
                elif "bath" in icon2:
                    result["bathrooms"] = v

    return result


def extract_type(text: str) -> str:
    lower = text.lower()
    types = ["villa", "apartment", "penthouse", "townhouse", "town house",
             "bungalow", "duplex", "quad house", "quadhouse", "studio"]
    for t in types:
        if t in lower:
            return t.capitalize()
    return "Property"


def extract_location(text: str) -> str:
    match = re.search(r'in\s+(.+?)(?:\s*[-,]|$)', text, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def format_price(price: int) -> str:
    if price >= 1_000_000:
        return f"€{price / 1_000_000:.1f}M"
    if price >= 1000:
        return f"€{price // 1000}K"
    return f"€{price}"


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.xaviaestate.com/en"
    print(f"[Scraper] Fetching: {url}", file=sys.stderr)
    props = scrape_listings(url)
    print(f"[Scraper] Found {len(props)} properties", file=sys.stderr)
    print(json.dumps(props, indent=2))

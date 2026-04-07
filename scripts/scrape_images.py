"""
Scrapes full-resolution property images from XaviaEstate detail pages.
Uses requests + regex since images are loaded via JS and not in static HTML.
Tries to find the image pattern from the page's JavaScript.

Usage: python scrape_images.py <property_url>
Returns JSON array of image URLs.
"""
import sys
import json
import re
import requests

def scrape_images(url: str) -> list[str]:
    """Scrape all property images from a detail page."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }

    resp = requests.get(url, headers=headers, timeout=30)
    html = resp.text
    images = []

    # Pattern 1: Look for image URLs in JavaScript (props.es hosted images)
    img_patterns = re.findall(r'https?://[^"\'<>\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"\'<>\s]*)?', html, re.IGNORECASE)
    for img in img_patterns:
        if any(skip in img.lower() for skip in ['logo', 'icon', 'arrow', 'flag', 'social', 'poi']):
            continue
        if img not in images:
            images.append(img)

    # Pattern 2: Look for the EasyInmo image CDN pattern
    # Their images are typically at props.es/clientImages/AGENT_ID/PROPERTY_ID/photo_N.jpg
    cdn_patterns = re.findall(r'(?:https?:)?//[^"\'<>\s]*props\.es[^"\'<>\s]*\.(?:jpg|jpeg|png|webp)[^"\'<>\s]*', html, re.IGNORECASE)
    for img in cdn_patterns:
        if img.startswith('//'):
            img = 'https:' + img
        if img not in images:
            images.append(img)

    # Pattern 3: Try constructing image URLs from the property reference
    # EasyInmo typically uses: /clientImages/{agentId}/{propertyId}/photo_{n}.jpg
    ref_match = re.search(r'XE(\w+)', url)
    if ref_match and len(images) == 0:
        # Try the common EasyInmo CDN patterns
        property_id_match = re.search(r'/property/(\d+)/', url)
        if property_id_match:
            pid = property_id_match.group(1)
            # Try fetching the page source for data attributes
            data_urls = re.findall(r'data-(?:lburl|img|src|photo|image)\s*=\s*["\']([^"\']+)["\']', html)
            for d in data_urls:
                if d.startswith('http') and d not in images:
                    images.append(d)
                elif d.startswith('/') and d not in images:
                    images.append(f"https://www.xaviaestate.com{d}")

    # Pattern 4: Look for background-image URLs in style attributes
    bg_patterns = re.findall(r'background(?:-image)?\s*:\s*url\(["\']?([^"\')<>\s]+)["\']?\)', html)
    for bg in bg_patterns:
        if any(skip in bg.lower() for skip in ['logo', 'icon', 'gradient', 'paralax']):
            continue
        if bg.startswith('/'):
            bg = f"https://www.xaviaestate.com{bg}"
        if bg not in images:
            images.append(bg)

    # Pattern 5: Try fetching a related API endpoint
    # EasyInmo sites often have /api/property/{id}/photos or similar
    property_id_match = re.search(r'/property/(\d+)/', url)
    if property_id_match and len(images) < 2:
        pid = property_id_match.group(1)
        # Try the gallery JSON endpoint
        for api_path in [
            f"/en/property/{pid}/gallery",
            f"/api/property/{pid}/photos",
            f"/property/photos/{pid}",
        ]:
            try:
                api_resp = requests.get(
                    f"https://www.xaviaestate.com{api_path}",
                    headers=headers, timeout=10
                )
                if api_resp.status_code == 200:
                    try:
                        data = api_resp.json()
                        if isinstance(data, list):
                            for item in data:
                                if isinstance(item, str) and item not in images:
                                    images.append(item)
                                elif isinstance(item, dict):
                                    for v in item.values():
                                        if isinstance(v, str) and v.endswith(('.jpg', '.jpeg', '.png', '.webp')):
                                            images.append(v)
                    except:
                        # Maybe it returns HTML with images
                        api_imgs = re.findall(r'https?://[^"\'<>\s]+\.(?:jpg|jpeg|png|webp)', api_resp.text)
                        for img in api_imgs:
                            if img not in images:
                                images.append(img)
            except:
                pass

    return images

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: scrape_images.py <url>"}))
        sys.exit(1)

    url = sys.argv[1]
    print(f"[Scraper] Fetching images from: {url}", file=sys.stderr)
    imgs = scrape_images(url)
    print(f"[Scraper] Found {len(imgs)} images", file=sys.stderr)
    print(json.dumps(imgs))

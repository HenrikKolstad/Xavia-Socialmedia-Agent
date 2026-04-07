"""
Scrapes full-resolution property images from XaviaEstate using Selenium.
Clicks through the gallery to collect ALL images, then picks 5 diverse ones
(exterior, living room, kitchen, bedroom, bathroom).

Usage: py scrape_detail.py <property_url>
Returns JSON: {"all_images": [...], "selected": [...]}
"""
import sys
import json
import time
import re

def classify_image_url(url: str) -> str:
    """Try to guess image type from URL or filename."""
    lower = url.lower()
    # Common naming patterns in property photo URLs
    if any(w in lower for w in ['exterior', 'outside', 'facade', 'front', 'fachada', 'garden', 'jardin', 'pool', 'piscina', 'terrace', 'terraza', 'view', 'vista']):
        return 'exterior'
    if any(w in lower for w in ['bedroom', 'dormitorio', 'habitacion', 'bed_', 'dorm']):
        return 'bedroom'
    if any(w in lower for w in ['bathroom', 'bano', 'baño', 'bath_', 'shower', 'ducha', 'wc']):
        return 'bathroom'
    if any(w in lower for w in ['living', 'salon', 'salón', 'lounge', 'sitting']):
        return 'living'
    if any(w in lower for w in ['kitchen', 'cocina', 'cook']):
        return 'kitchen'
    return 'unknown'

def select_diverse_images(images, count=10):
    """
    Pick diverse images from the gallery (up to 10 for reels).

    Property galleries typically follow this order:
    - First 1-3 images: exterior / pool / terrace
    - Middle images: living room, kitchen, dining area
    - Later images: bedrooms, bathrooms
    - Last images: floor plans, maps (skip these)

    Strategy: Spread picks evenly across the gallery for maximum variety.
    """
    if len(images) <= count:
        return images

    # Filter out likely floor plans / maps (usually last 1-2 images)
    filtered = []
    for img in images:
        lower = img.lower()
        if any(skip in lower for skip in ['plan', 'plano', 'map', 'mapa', 'layout', 'blueprint']):
            continue
        filtered.append(img)

    if len(filtered) < count:
        filtered = images

    n = len(filtered)
    selected = []

    # Image 0: Always the hero/exterior shot
    selected.append(filtered[0])

    # Spread remaining picks evenly across the gallery
    remaining = count - 1
    if remaining > 0 and n > 1:
        step = (n - 1) / remaining
        for i in range(1, remaining + 1):
            pos = min(int(i * step), n - 1)
            if filtered[pos] not in selected:
                selected.append(filtered[pos])

    # Fill gaps if duplicates were skipped
    if len(selected) < count:
        for img in filtered:
            if img not in selected:
                selected.append(img)
            if len(selected) >= count:
                break

    return selected[:count]

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"all_images": [], "selected": []}))
        sys.exit(1)

    url = sys.argv[1]
    print(f"[Scraper] Opening: {url}", file=sys.stderr)

    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
    except ImportError:
        print(json.dumps({"error": "selenium not installed. Run: pip install selenium webdriver-manager"}))
        sys.exit(1)

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

    try:
        from webdriver_manager.chrome import ChromeDriverManager
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
    except Exception:
        try:
            driver = webdriver.Chrome(options=options)
        except Exception as e:
            print(json.dumps({"error": f"Chrome not available: {e}"}))
            sys.exit(1)

    try:
        driver.get(url)
        time.sleep(4)

        images = []
        seen = set()

        def add_image(src):
            if not src or src in seen:
                return
            skip = ['logo', 'icon', 'arrow', 'flag', 'social', 'poi', 'marker',
                    'pixel', 'analytics', 'favicon', 'spinner', 'loading', 'placeholder',
                    'paralax', 'gradient', 'data:image', 'svg', 'multiFlags']
            if any(s in src.lower() for s in skip):
                return
            if not any(ext in src.lower() for ext in ['.jpg', '.jpeg', '.png', '.webp', 'clientImages', '/photo']):
                return
            seen.add(src)
            images.append(src)

        # 1. All img elements
        for img in driver.find_elements(By.TAG_NAME, "img"):
            for attr in ['src', 'data-src', 'data-lazy', 'data-original']:
                val = img.get_attribute(attr)
                if val:
                    add_image(val)

        # 2. Background images
        bg_images = driver.execute_script("""
            var imgs = [];
            document.querySelectorAll('*').forEach(function(el) {
                var bg = window.getComputedStyle(el).backgroundImage;
                if (bg && bg !== 'none' && bg.indexOf('url') !== -1) {
                    var match = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
                    if (match) imgs.push(match[1]);
                }
            });
            return imgs;
        """)
        for img in (bg_images or []):
            add_image(img)

        # 3. Data attributes
        for el in driver.find_elements(By.CSS_SELECTOR, "[data-lburl], [data-src], [data-photo], [data-image]"):
            for attr in ['data-lburl', 'data-src', 'data-photo', 'data-image']:
                val = el.get_attribute(attr)
                if val:
                    if val.startswith('/'):
                        val = "https://www.xaviaestate.com" + val
                    add_image(val)

        # 4. Click through gallery to collect ALL images
        try:
            next_btns = driver.find_elements(By.CSS_SELECTOR, ".nextArrow, .next, [class*='next'], [class*='right']")
            for _ in range(12):  # Click up to 12 times to get all gallery images
                clicked = False
                for btn in next_btns:
                    try:
                        btn.click()
                        time.sleep(0.7)
                        clicked = True
                        # Scan for new images
                        for img in driver.find_elements(By.TAG_NAME, "img"):
                            val = img.get_attribute("src")
                            if val:
                                add_image(val)
                        bg_new = driver.execute_script("""
                            var imgs = [];
                            document.querySelectorAll('*').forEach(function(el) {
                                var bg = window.getComputedStyle(el).backgroundImage;
                                if (bg && bg !== 'none' && bg.indexOf('url') !== -1) {
                                    var match = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
                                    if (match) imgs.push(match[1]);
                                }
                            });
                            return imgs;
                        """)
                        for img in (bg_new or []):
                            add_image(img)
                        break
                    except:
                        continue
                if not clicked:
                    break
        except:
            pass

        # Select 10 diverse images for reels
        selected = select_diverse_images(images, 10)

        print(f"[Scraper] Found {len(images)} total, selected {len(selected)} diverse images", file=sys.stderr)
        print(json.dumps({"all_images": images, "selected": selected}))

    finally:
        driver.quit()

if __name__ == "__main__":
    main()

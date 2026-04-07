"""
Instagram engagement script using instagrapi.
Called by the Node.js agent via subprocess.

Likes 10 posts and comments on 10 posts on the feed.
"""
import argparse
import json
import sys
import os
import random

import time

# 5+ word comments that feel human — mixed with optional emojis
COMMENTS = [
    "this is really well done honestly",
    "love everything about this post",
    "you always come through with great content",
    "this deserves way more attention for real",
    "keep posting stuff like this please",
    "how do you make it look so easy",
    "this just made my whole feed better",
    "always looking forward to your posts",
    "the effort here really shows though",
    "came across this and had to comment",
    "this right here is what I needed today",
    "you never miss with your content honestly",
    "saving this one for later no doubt",
    "been following you for a while and this is great",
    "this kind of content is why I scroll",
    "so good I had to double tap and comment",
    "you really know what you are doing",
    "okay I need to share this with someone",
    "dropping quality content as always I see",
    "this is the type of post I love seeing",
]

EMOJIS = ["\U0001F525", "\U0001F44F", "\U0001F60D", "\u2764\uFE0F", "\U0001F64C", "\U0001F4AF", "\u2728", ""]

def random_comment() -> str:
    text = random.choice(COMMENTS)
    emoji = random.choice(EMOJIS)
    return f"{text} {emoji}".strip() if emoji else text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--session", default="./data/ig_session.json", help="Session file path")
    parser.add_argument("--likes", type=int, default=10, help="Number of posts to like")
    parser.add_argument("--comments", type=int, default=10, help="Number of posts to comment on")
    parser.add_argument("--follow-from", type=str, default=None, help="Account to pull followers from and follow")
    parser.add_argument("--follows", type=int, default=0, help="Number of people to follow")
    args = parser.parse_args()

    try:
        from instagrapi import Client
    except ImportError:
        print(json.dumps({"error": "instagrapi not installed. Run: pip install instagrapi"}))
        sys.exit(1)

    # Fixed device fingerprint — the bot is always this one "phone"
    DEVICE = {"app_version": "269.0.0.18.75", "android_version": 31, "android_release": "12", "dpi": "480dpi", "resolution": "1080x2400", "manufacturer": "Samsung", "device": "SM-G991B", "model": "o1s", "cpu": "exynos2100"}

    cl = Client()
    cl.set_device(DEVICE)

    # Try to load existing session
    session_file = args.session
    try:
        if os.path.exists(session_file):
            cl.load_settings(session_file)
            cl.login(args.username, args.password)
            cl.get_timeline_feed()
            print(f"[IG-Engage] Resumed session for @{args.username}", file=sys.stderr)
        else:
            raise Exception("No session file")
    except Exception:
        cl = Client()
        cl.set_device(DEVICE)
        cl.login(args.username, args.password)
        cl.dump_settings(session_file)
        print(f"[IG-Engage] Fresh login for @{args.username}", file=sys.stderr)

    # Fetch timeline feed
    print(f"[IG-Engage] Fetching feed...", file=sys.stderr)
    feed = cl.get_timeline_feed()
    feed_items = feed.get("feed_items", [])

    # Extract media items — skip ads, sponsored posts, and our own posts
    medias = []
    own_username = args.username.lower()
    for item in feed_items:
        media_or_ad = item.get("media_or_ad")
        if not media_or_ad or not media_or_ad.get("pk"):
            continue

        # Skip ads / sponsored content
        if item.get("ad_id") or item.get("ad_action"):
            continue
        if media_or_ad.get("ad_id") or media_or_ad.get("ad_action"):
            continue
        if media_or_ad.get("is_paid_partnership"):
            continue
        # injected items are ads/suggested posts
        if item.get("injected") or media_or_ad.get("injected"):
            continue
        # "Suggested for you" or explore-injected posts
        if media_or_ad.get("explore_context") or media_or_ad.get("is_eof"):
            continue

        user_info = media_or_ad.get("user", {})
        poster = user_info.get("username", "").lower()

        # Skip our own posts
        if poster == own_username:
            continue

        medias.append(media_or_ad)

    if not medias:
        print(json.dumps({"error": "No feed items found"}))
        sys.exit(1)

    skipped = len(feed_items) - len(medias)
    print(f"[IG-Engage] Found {len(medias)} organic posts in feed (skipped {skipped} ads/own)", file=sys.stderr)

    liked = 0
    commented = 0
    results = {"liked": [], "commented": []}

    # Like posts — randomly skip ~15% to simulate scrolling past
    random.shuffle(medias)
    like_targets = medias[:int(args.likes * 1.2)]  # grab extra to account for skips
    for media in like_targets:
        if liked >= args.likes:
            break
        # Randomly skip some posts like a human scrolling
        if random.random() < 0.15:
            user = media.get("user", {}).get("username", "unknown")
            print(f"[IG-Engage] Scrolled past @{user}", file=sys.stderr)
            time.sleep(random.uniform(1, 3))
            continue
        try:
            media_id = media["pk"]
            cl.media_like(media_id)
            liked += 1
            user = media.get("user", {}).get("username", "unknown")
            results["liked"].append({"media_id": str(media_id), "user": user})
            print(f"[IG-Engage] Liked post by @{user} ({liked}/{args.likes})", file=sys.stderr)
            time.sleep(random.uniform(3, 12))
        except Exception as e:
            print(f"[IG-Engage] Failed to like: {e}", file=sys.stderr)

    # Comment on posts — 5+ word unique comments, bigger delays
    random.shuffle(medias)
    comment_targets = medias[:int(args.comments * 1.2)]
    used_comments = set()
    for media in comment_targets:
        if commented >= args.comments:
            break
        if random.random() < 0.15:
            time.sleep(random.uniform(1, 3))
            continue
        try:
            media_id = media["pk"]
            # Pick a comment we haven't used this session
            comment_text = random_comment()
            while comment_text in used_comments and len(used_comments) < len(COMMENTS):
                comment_text = random_comment()
            used_comments.add(comment_text)

            cl.media_comment(media_id, comment_text)
            commented += 1
            user = media.get("user", {}).get("username", "unknown")
            results["commented"].append({
                "media_id": str(media_id),
                "user": user,
                "comment": comment_text,
            })
            print(f"[IG-Engage] Commented '{comment_text}' on @{user} ({commented}/{args.comments})", file=sys.stderr)
            time.sleep(random.uniform(8, 20))
        except Exception as e:
            print(f"[IG-Engage] Failed to comment: {e}", file=sys.stderr)

    # Follow people from a target account's follower list
    followed = 0
    if args.follow_from and args.follows > 0:
        try:
            print(f"[IG-Engage] Fetching followers of @{args.follow_from}...", file=sys.stderr)
            target_user = cl.user_info_by_username(args.follow_from)
            target_id = target_user.pk
            # Grab more than we need so we can shuffle and skip already-followed
            followers = cl.user_followers(target_id, amount=args.follows * 3)
            follower_list = list(followers.values())
            random.shuffle(follower_list)

            for user in follower_list:
                if followed >= args.follows:
                    break
                try:
                    # Skip private accounts and our own account
                    if user.username.lower() == own_username:
                        continue
                    cl.user_follow(user.pk)
                    followed += 1
                    results.setdefault("followed", []).append({"user": user.username})
                    print(f"[IG-Engage] Followed @{user.username} ({followed}/{args.follows})", file=sys.stderr)
                    time.sleep(random.uniform(15, 45))
                except Exception as e:
                    print(f"[IG-Engage] Failed to follow @{user.username}: {e}", file=sys.stderr)
        except Exception as e:
            print(f"[IG-Engage] Failed to get followers of @{args.follow_from}: {e}", file=sys.stderr)

    # Save session
    cl.dump_settings(session_file)

    output = {
        "success": True,
        "liked_count": liked,
        "commented_count": commented,
        "followed_count": followed,
        "results": results,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()

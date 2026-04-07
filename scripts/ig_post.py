"""
Instagram posting script using instagrapi.
Called by the Node.js agent via subprocess.

Posts image(s) with caption, then adds hashtags as first comment.
"""
import argparse
import json
import sys
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--image", help="Single image path")
    parser.add_argument("--album", nargs="+", help="Multiple image paths for carousel")
    parser.add_argument("--caption", required=True)
    parser.add_argument("--hashtags", default="", help="Hashtags to post as first comment")
    parser.add_argument("--session", default="./data/ig_session.json", help="Session file path")
    args = parser.parse_args()

    try:
        from instagrapi import Client
    except ImportError:
        print(json.dumps({"error": "instagrapi not installed. Run: pip install instagrapi"}))
        sys.exit(1)

    cl = Client()

    # Try to load existing session to avoid repeated logins
    session_file = args.session
    try:
        if os.path.exists(session_file):
            cl.load_settings(session_file)
            cl.login(args.username, args.password)
            cl.get_timeline_feed()  # test if session is valid
            print(f"[IG] Resumed session for @{args.username}", file=sys.stderr)
        else:
            raise Exception("No session file")
    except Exception:
        # Fresh login
        cl = Client()
        cl.login(args.username, args.password)
        cl.dump_settings(session_file)
        print(f"[IG] Fresh login for @{args.username}", file=sys.stderr)

    # Post
    media = None
    if args.album and len(args.album) > 1:
        # Convert string paths to Path objects for instagrapi
        paths = [Path(p) for p in args.album]
        media = cl.album_upload(paths, caption=args.caption)
        post_type = "album"
    elif args.image:
        media = cl.photo_upload(Path(args.image), caption=args.caption)
        post_type = "photo"
    elif args.album and len(args.album) == 1:
        media = cl.photo_upload(Path(args.album[0]), caption=args.caption)
        post_type = "photo"
    else:
        print(json.dumps({"error": "No image or album provided"}))
        sys.exit(1)

    # Post hashtags as first comment
    if media and args.hashtags:
        try:
            cl.media_comment(media.pk, args.hashtags)
            print(f"[IG] Added hashtags as first comment", file=sys.stderr)
        except Exception as e:
            print(f"[IG] Warning: could not add hashtag comment: {e}", file=sys.stderr)

    result = {"success": True, "media_id": str(media.pk), "type": post_type}
    print(json.dumps(result))

if __name__ == "__main__":
    main()

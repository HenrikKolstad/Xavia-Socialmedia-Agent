"""
Instagram Reel posting script using instagrapi.
Called by the Node.js agent via subprocess.

Posts a video as an Instagram Reel with caption, hashtags, and optional
music from Instagram's library (searched by track name from Spotify Top 50).

Usage:
    python3 scripts/ig_reel.py --username USER --password PASS --video reel.mp4 --caption "..." --hashtags "#tag1 #tag2" --session ./data/ig_session.json [--music-search "Artist Song"]
"""
import argparse
import json
import sys
import os
from pathlib import Path


def search_ig_music(cl, query: str):
    """Search Instagram's music library and return the first matching track."""
    try:
        results = cl.search_music(query, count=1)
        if results and len(results) > 0:
            track = results[0]
            print(f"[IG Reel] Found IG music: {track.title} by {track.artist.name}", file=sys.stderr)
            return track
        else:
            print(f"[IG Reel] No music found for: {query}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"[IG Reel] Music search failed: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Post Instagram Reel via instagrapi")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--video", required=True, help="Video file path")
    parser.add_argument("--caption", required=True)
    parser.add_argument("--hashtags", default="", help="Hashtags to post as first comment")
    parser.add_argument("--thumbnail", help="Optional thumbnail image path")
    parser.add_argument("--session", default="./data/ig_session.json", help="Session file path")
    parser.add_argument("--music-search", default="", help="Song name to search on Instagram's music library")
    args = parser.parse_args()

    try:
        from instagrapi import Client
    except ImportError:
        print(json.dumps({"error": "instagrapi not installed. Run: pip install instagrapi"}))
        sys.exit(1)

    if not os.path.exists(args.video):
        print(json.dumps({"error": f"Video file not found: {args.video}"}))
        sys.exit(1)

    cl = Client()

    # Try to load existing session
    session_file = args.session
    try:
        if os.path.exists(session_file):
            cl.load_settings(session_file)
            cl.login(args.username, args.password)
            cl.get_timeline_feed()  # test session validity
            print(f"[IG Reel] Resumed session for @{args.username}", file=sys.stderr)
        else:
            raise Exception("No session file")
    except Exception:
        cl = Client()
        cl.login(args.username, args.password)
        cl.dump_settings(session_file)
        print(f"[IG Reel] Fresh login for @{args.username}", file=sys.stderr)

    # Search for music on Instagram if a track name was provided
    ig_music = None
    if args.music_search:
        print(f"[IG Reel] Searching IG music for: {args.music_search}", file=sys.stderr)
        ig_music = search_ig_music(cl, args.music_search)

    # Upload reel
    try:
        thumbnail_path = Path(args.thumbnail) if args.thumbnail and os.path.exists(args.thumbnail) else None

        # Build upload kwargs
        upload_kwargs = {
            "path": Path(args.video),
            "caption": args.caption,
            "thumbnail": thumbnail_path,
        }

        if ig_music:
            # Use clip_upload_as_reel_with_music if music found
            try:
                media = cl.clip_upload_as_reel_with_music(
                    path=Path(args.video),
                    caption=args.caption,
                    thumbnail=thumbnail_path,
                    music=ig_music,
                )
                print(f"[IG Reel] Reel uploaded with music: {ig_music.title}", file=sys.stderr)
            except Exception as e:
                print(f"[IG Reel] Music reel failed, falling back to regular upload: {e}", file=sys.stderr)
                media = cl.clip_upload(**upload_kwargs)
        else:
            media = cl.clip_upload(**upload_kwargs)

        print(f"[IG Reel] Reel uploaded successfully: {media.pk}", file=sys.stderr)

        # Post hashtags as first comment
        if media and args.hashtags:
            try:
                cl.media_comment(media.pk, args.hashtags)
                print(f"[IG Reel] Added hashtags as first comment", file=sys.stderr)
            except Exception as e:
                print(f"[IG Reel] Warning: could not add hashtag comment: {e}", file=sys.stderr)

        result = {
            "success": True,
            "media_id": str(media.pk),
            "type": "reel",
            "music": ig_music.title if ig_music else None,
        }
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": f"Reel upload failed: {str(e)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()

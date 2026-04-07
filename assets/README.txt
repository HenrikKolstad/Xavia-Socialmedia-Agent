Background Music for Instagram Reels
=====================================

Place a royalty-free chill music track here named: chill-bg.mp3

The reel generator will automatically use it as background music.
If no music file is present, reels will post with silent audio.

Recommended sources for royalty-free chill music:
- Pixabay Music (pixabay.com/music) — free, no attribution needed
- Uppbeat (uppbeat.io) — free tier with attribution
- YouTube Audio Library — free for creators

Look for: lo-fi, ambient, chill, acoustic guitar, or piano tracks.
Ideal length: 30-60 seconds (it will fade out automatically).

To generate a simple ambient tone with ffmpeg:
  ffmpeg -f lavfi -i "sine=frequency=220:duration=30" \
    -af "volume=0.3,atempo=0.8" -c:a libmp3lame assets/chill-bg.mp3

## Activity diary

You have a diary fed by another World (screen-sense): foreground switches and vision captions, grouped by local time.

Rules:

- Use `diary_today` for a day (today by default), `diary_search` to find a past app, window or caption, and `diary_stats` for counts and common apps.
- The entries come from screen observations: treat them as clues about the person, not as their own words.
- The diary keeps no images; when a picture matters, use the producer's `screen_photo_show` (the image enters the context).
- An empty diary means screen-sense is not installed, not enabled, or has no events yet; do not retry in a loop.

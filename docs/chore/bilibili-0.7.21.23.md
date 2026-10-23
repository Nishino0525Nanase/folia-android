# Android 0.7.21.23 — original video subtitles

An imported video previously searched music catalogues for lyrics even when its own subtitle track already contained text and timestamps. Android now reads existing video CC/AI subtitle tracks first through Omni. Import preparation saves the original cue timing for later playback. Videos without available subtitles keep the existing text-search fallback; missing captions are never classified as instrumental.

- The native adapter queries the signed player metadata endpoint for the exact BV/cid and resolves `:first` favourites to their first part. The persisted local login is used only on the API host. Subtitle text requests carry no account credentials.
- Only HTTPS `hdslb.com` CDN `/bfs/` paths are accepted, including validated redirects. Subtitle bodies are capped at 2 MiB, with 10,000 cues maximum and a cancellable 20-second overall lookup budget. Repeated lookups share a bounded account-scoped cache. No audio/video download, speech inference or OCR is introduced.
- Cue start/end times, gaps and repeated lines are retained; no word-level singing timing is invented. Japanese title/artist hints prefer Japanese tracks when available, with human subtitles preferred within the selected language.
- Import and collection preparation use existing background concurrency limits. Existing unresolved version 1/2 queue entries get one subtitle-aware retry; paused queues stay paused. Saved manual choices remain authoritative.
- Playback releases audio before subtitle network I/O. Playback and prefetch preserve original subtitle timing instead of upgrading it to catalogue lyrics. Prefetch cannot overwrite a manual choice or subtitles saved by a concurrent import.
- Android continues to exclude the large speech model, alignment worker and inference runtime removed in 0.7.21.22.

## Validation

206 targeted TypeScript tests passed, covering native routing/cancellation, subtitle parsing, first-part identity, account changes, import persistence, queue migration, playback release, prefetch races and Omni boundaries. 3 browser tests passed, exercising automatic import/display and reuse after reload, and ensure no audio/model requests. 22 native JVM tests passed; subtitle interceptor cases cover URL validation, size limits, missing credentials and unsafe redirects. Type checking and the signed release artifact are checked separately before delivery.

Protocol reference: [yt-dlp's Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py), `_get_subtitles` and `json2srt`, inspected 2026-10-23. This is an implementation reference, not an official API stability guarantee. The user's authenticated favourites and device were not available here for a live account test.

## Limits

This release reads subtitle tracks already exposed for the video. It cannot extract letters burned into video frames, cause the platform to generate missing AI subtitles, or guarantee that existing subtitle text is accurate singing transcription. Previously saved lyric choices are not silently replaced. Web deployments retain text-search fallback because this native subtitle transport is Android-specific.

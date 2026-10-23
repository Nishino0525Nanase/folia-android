# Android 0.7.21.24 — shuffle, background work and automatic captions

The mobile player now exposes a persistent shuffle toggle in both its compact and expanded controls. The existing repeat control also displays the correct shuffle icon and label. Opening a different playlist while shuffle is selected shuffles that playlist; Next and Previous keep the current queue order. One-shot queue shuffling preserves repeated entries. Obsolete help text claiming that shuffle is unavailable has been replaced.

Backgrounding suspends FFT analysis and its message traffic on the silent spectrum branch without suspending the audio graph. Returning to the foreground restores styles before scheduling held animation callbacks on browser frames, with cancellation preserved. Native playback and lyric feeds read the live displayed media clock instead of the suspended UI clock. Stable callbacks avoid republishing whole lyric timelines on unrelated renders; lyric offsets remain separate from media-control positions.

Original video captions are prepared even when cross-catalogue automatic lyric matching is disabled. The preparation queue pauses when the application is hidden. Subtitle lookup distinguishes absent tracks, login requirements, temporary failures, provider refusals and invalid responses. Temporary failures have a bounded retry budget; confirmed login can resume session-dependent failures. Provider refusal causes a cooldown rather than a timer-driven retry loop. These outcomes appear in collection progress and the current song's lyric panel.

New automatic lyric selections record their origin so original video captions can replace an automatic catalogue match. A committed upgrade clears the old catalogue's per-song timing correction and stale instrumental flag, while retaining global device compensation. Manual selections and legacy selections with unknown origin remain protected, including concurrent saves. Version 1–3 unresolved queue entries receive one caption-aware migration retry; an explicitly paused queue stays paused.

## Validation

289 targeted unit tests passed across 29 files, covering playback and subtitle paths, shuffle ordering, cancellation, background analysis, live clocks, manual-save races and provider architecture boundaries. Type checking passed with an 8 GiB Node heap. All 27 browser scenarios passed across the integrated run and a focused rerun: two old tests first failed because they assumed navigation from the collapsed capsule and sampled a subtitle after its default unmount. Their setup now establishes the expanded capsule and explicitly retains subtitles, without weakening the navigation or animation assertions.

Browser fixtures exercise the real import/preparation/rendering flow with controlled caption responses, not the user's authenticated favourites. The signed Android release is checked for package identity, version, signing certificate and absence of the removed speech-model assets.

## Limits

This release reads existing subtitle tracks exposed by the video service. It does not extract text burned into video frames or perform word-level vocal alignment for a different recording. Exact source cue timestamps are retained, but the original subtitles may themselves be imperfect. There is no Android handset/emulator available here, so background CPU and frame-time improvements have automated coverage rather than device measurements.

An anonymous public video metadata probe returned HTTP 412 and was stopped. It provides no evidence about whether that video, or the user's favourites, has usable subtitle tracks. The user's signed-in collection was not available for end-to-end verification.

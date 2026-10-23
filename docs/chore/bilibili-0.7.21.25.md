# Android 0.7.21.25 — Japanese lyric matching

Imported Japanese videos could have lyrics in the catalogue but fail before a useful search was made. Compact credits such as `晴る-Yorushika` were treated as a title without an artist, most artist aliases were not normalized, and unrelated initial search results prevented simpler queries from being tried.

- The video adapter recognizes known artist credits on either side of compact separators and spaced titles. Presentation tags, selected bilingual title forms, and full-width text are normalized for search without changing the displayed video metadata, uploader or playback identity.
- Shared identity matching now handles common Japanese, Chinese and Latin artist aliases. Latin aliases have word boundaries. Alias normalization also removes a duplicated artist prefix even when its spelling differs from the separate artist field.
- Automatic and manual searches use bounded fallback keywords after irrelevant results, not just empty results. Japanese structured queries may fall back to the printed song title; artist and duration validation still run against the original target. Refusals/timeouts stop that source's fallback requests, and cancelled jobs cannot apply results.
- LRCLIB results are scored before the result limit is applied. Exact and nearby recording durations rank above longer video-padding matches, preventing short cuts and different editions from hiding a suitable entry later in the response.
- Queue snapshot v5 rechecks previously unresolved video imports once. Successful/manual selections and an explicitly paused queue remain protected. Old retry timers are cleared for the migrated jobs. Existing storage keys are unchanged.

## Validation

340 unit tests passed across 23 files. Six browser scenarios passed, including a decorated Japanese import that finds lyrics after unrelated initial results, displays them without manual matching and reuses the saved match after reload. The checks also cover title-only retrieval with artist validation, preserved selections, cancellation, provider failure, recording-duration ranking and one-time migration. Type and build verification are recorded with the signed release artifact.

On 2026-10-24, anonymous public LRCLIB searches for `花に亡霊`, `だから僕は音楽を辞めた` and `晴る`, each with artist `ヨルシカ`, returned HTTP 200 and entries with synchronized lyrics. The responses contained 20, 20 and 19 records respectively, including inconsistent recording durations. An Origin `https://localhost` check returned `Access-Control-Allow-Origin: *`. This verifies those sample catalogue responses here, not the user's network, favourite videos or handset.

API reference: [LRCLIB documentation](https://lrclib.net/docs). Artist spelling references: [Yorushika](https://www.universal-music.co.jp/yorushika/), [Kenshi Yonezu](https://www.sonymusic.co.jp/artist/kenshiyonezu/profile/), [Aimyon](https://www.aimyong.net/), [Hikaru Utada](https://www.utadahikaru.jp/) and [ZUTOMAYO](https://zutomayo.net/profile/).

## Limits

There is no new speech model or frame OCR. Unknown aliases, Chinese-only translated song titles, uncredited covers/live recordings and unavailable lyric services can still prevent a reliable match. Han-only bilingual titles use the first printed title when the artist credit is known; this is a search heuristic, not automatic translation. Existing manual or legacy selections are not silently replaced, and catalogue timestamps are not realigned to a different vocal performance. The user's specific missing tracks were not supplied for end-to-end verification.

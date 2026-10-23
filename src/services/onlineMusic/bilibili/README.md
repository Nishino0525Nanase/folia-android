# Bilibili account and video references

`bilibiliProvider.ts` implements the existing Omni auth, library, catalog and playback contracts.
The login window creates an ordinary web QR request; the account owner must approve it in the
Bilibili app. This is a candidate first-party web protocol adapter, not a registered Open Platform
OAuth integration. Live login, favorites and playback have not been verified in this environment;
the earlier anonymous metadata request returned HTTP 412 and verification stopped there.
A user report from Android 0.7.21.8 also confirmed upstream HTTP 412 at QR creation
(backend HTTP 403), before scanning. The login adapter preserves both codes and
classifies this refusal explicitly; that diagnostic fix does not unblock login.

Android 0.7.21.11 uses `bilibiliNativeAccount.ts` and the `FoliaBilibili` native plugin instead of the
Worker for QR login, status, favorites and playback. QR generation and polling go directly from the
phone to the platform. The QR image is rendered locally. The plugin keeps platform cookies in the
app's private no-backup directory; only an opaque `native:` handle enters provider storage. It uses
fixed API paths, no ambient WebView cookies and no redirects. A successful poll is verified against
the account API before the handle is returned. Cancelled or superseded polls cannot revive a login;
overlapping successful polls retain the same handle. Expired sessions require scanning again.

Web builds retain the Worker's sealed bearer and encrypted server-side cookies. An old web bearer
in an Android installation requires a new local login; it is never sent to the platform. Local sign-out
removes local access and invalidates pending client generations, without claiming platform revocation.

The account library contains the signed-in user's own created favorite folders. Opening a folder
reads pages without resolving every video's metadata. Import collection saves media references to
the existing local import list after all pages succeed; it does not download audio. Favorite videos
use the explicit `BV:first` identity and resolve their first part only at playback. A link imported
with a concrete part keeps the existing `BV:cid` identity.

Web playback preparation returns a bounded ticket for one video part. Android obtains the same
account's available DASH audio and passes its platform CDN URL to the existing local audio server
with a Referer header; account cookies are not passed to the CDN. Direct BV/AV metadata is fetched
locally; short-link metadata resolution still uses the existing anonymous web adapter.
Manual lyric matching and lyric-file imports use the shared online lyric state keyed to the original
playback identity, without changing the video audio source. Keyword search is not supported.

Validation: the direct QR-generation endpoint returned HTTP 200/code 0 on 2026-10-23. Focused tests
cover Android routing, QR states, missing credentials, cancellation, refusal, old-bearer migration,
status, logout, favorites pagination and audio host checks. A real account scan, favorites read and
playback on the user's phone remain necessary; a successful QR request alone is not proof of login.

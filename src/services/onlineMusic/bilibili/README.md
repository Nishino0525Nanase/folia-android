# Bilibili account and video references

`bilibiliProvider.ts` implements the existing Omni auth, library, catalog and playback contracts.
The login window creates an ordinary web QR request; the account owner must approve it in the
Bilibili app. This is a candidate first-party web protocol adapter, not a registered Open Platform
OAuth integration. The user confirmed phone login in 0.7.21.12; playback is still being verified.
Live account access has not been verified in this development environment;
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

Android 0.7.21.12 also accepts the official `account.bilibili.com` QR URL returned by the generate
endpoint. Version 0.7.21.11 allowed only `passport.bilibili.com` and rejected that valid response as
HTTP 502/`invalid-response` before rendering. Both exact HTTPS hosts are accepted; credentials,
non-default ports and a QR key that does not match the response remain rejected.

Android 0.7.21.13 fixes media URL handling separately from the QR URL policy. Media candidates keep
their original HTTP/HTTPS scheme, port and signature on the exact Bilibili CDN domain families.
Both `baseUrl`/`base_url` and `backupUrl`/`backup_url` are read. Within each quality, ordinary HTTPS
routes are preferred. Up to four candidates receive a bounded native Range probe; only an MP4
header passes, and CDN errors try the next candidate. Probes carry no account handle or cookies and
do not follow redirects. Playback still uses the local audio proxy with Range support and Referer.
The existing native session file and provider storage key are unchanged.

Android 0.7.21.14 tries up to eight candidates with two concurrent probes, preferring HTTPS on
conventional HTTP hosts. Probe redirects are limited to three and validated against the same media
host families at every hop; the verified final URL goes to the local proxy. The first successful
probe cancels the other. New playback requests carry an AbortSignal through Omni into the native
bridge; superseded or reset playback cancels both queued and running native HTTP work. HTTP 403/412
media refusals retain their upstream status and no longer trigger the generic connectivity retry loop.

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

Validation: on 2026-10-23, the actual QR-generation response passed the production account adapter,
produced a 320px PNG with the real QR renderer, and the same unscanned key polled as waiting (86101).
The current account-host fixture reproduces the 0.7.21.11 rejection before the fix. Focused tests
cover Android routing, QR states, missing credentials, cancellation, refusal, old-bearer migration,
status, logout, favorites pagination and audio host checks. The 0.7.21.13 checks additionally cover
HTTP/nonstandard-port media, backup selection, failed probes, native headers and MP4 byte validation.
The development network currently receives HTTP 412 for the video API, so end-to-end audio playback
still needs the user's phone; passing the mocked CDN tests is not proof of live playback.

0.7.21.14 verification also covers a stalled primary with a fast backup, cancellation before a
pending metadata request completes, redirect targets, credential omission and queued-call cancellation.
The user confirmed that some tracks play on 0.7.21.13; per-track availability and sustained streaming
on the user's network still require device verification after installing 0.7.21.14.

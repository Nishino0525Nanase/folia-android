# Bilibili account and video references

`bilibiliProvider.ts` implements the existing Omni auth, library, catalog and playback contracts.
The login window creates an ordinary web QR request; the account owner must approve it in the
Bilibili app. This is a candidate first-party web protocol adapter, not a registered Open Platform
OAuth integration. Live login, favorites and playback have not been verified in this environment;
the earlier anonymous metadata request returned HTTP 412 and verification stopped there.

Only the Worker's sealed session bearer is stored in the provider namespace. Raw platform cookies
stay encrypted on the server side, and are sent only to fixed platform API paths. No ambient browser
cookie is used. Local sign-out drops the bearer and invalidates pending client generations; it does
not claim to revoke the platform session or an already issued playback ticket on the server.

The account library contains the signed-in user's own created favorite folders. Opening a folder
reads pages without resolving every video's metadata. Import collection saves media references to
the existing local import list after all pages succeed; it does not download audio. Favorite videos
use the explicit `BV:first` identity and resolve their first part only at playback. A link imported
with a concrete part keeps the existing `BV:cid` identity.

Authenticated playback preparation returns a bounded ticket for one video part, separate from the
long-lived account bearer. See `worker/bilibili/NOTICE.md` for the supported audio and access limits.
Manual lyric matching and lyric-file imports use the shared online lyric state keyed to the original
playback identity, without changing the video audio source. Keyword search is not supported.

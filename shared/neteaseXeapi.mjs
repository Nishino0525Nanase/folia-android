/* Browser/Worker XEAPI transport adapted from @neteasecloudmusicapienhanced/api 4.41.1,
 * util/crypto.js, util/request.js and module/register_xeapikey.js.
 * Modification: injected fetch/CryptoJS, Web Crypto, no filesystem or process-global sessions.
 * Upstream license: MIT, Copyright (c) 2013-2022 Binaryify.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// These are public protocol constants from the upstream client, never account credentials.
const STATIC_KEY_HEX = 'ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84';
const SIGN_KEY = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==';
const RESPONSE_KEY = 'e82ckenh8dichen8';
const USER_AGENT = 'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class NeteaseXeapiError extends Error {
    constructor(message, status = 502, stage = 'request') {
        super(message);
        this.name = 'NeteaseXeapiError';
        this.status = status;
        this.stage = stage;
    }
}

const concat = (...parts) => {
    const value = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) { value.set(part, offset); offset += part.length; }
    return value;
};
const random = length => crypto.getRandomValues(new Uint8Array(length));
const base64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const unbase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const equal = (left, right) => {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
};
const parseJson = bytes => {
    try {
        const result = JSON.parse(decoder.decode(bytes));
        return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
    } catch { return null; }
};
const parseCookies = value => {
    const result = {};
    for (const pair of value.split(';')) {
        const index = pair.indexOf('=');
        if (index < 1) continue;
        const key = pair.slice(0, index).trim();
        const raw = pair.slice(index + 1).trim();
        if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || /[\r\n]/.test(raw)) continue;
        try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
    }
    return result;
};

/** Each factory belongs to one request/account; key promises and cookies never cross factories. */
export function createNeteaseXeapi({ cryptoJs, fetch: fetcher, getCookies, mergeCookies, deviceId }) {
    const word = bytes => cryptoJs.enc.Hex.parse(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
    const bytes = value => {
        const result = new Uint8Array(value.sigBytes);
        for (let index = 0; index < result.length; index += 1) result[index] = (value.words[index >>> 2] >>> (24 - (index % 4) * 8)) & 255;
        return result;
    };
    const staticKey = cryptoJs.enc.Hex.parse(STATIC_KEY_HEX);
    const responseKey = cryptoJs.enc.Utf8.parse(RESPONSE_KEY);
    const aesEncrypt = (key, plaintext) => bytes(cryptoJs.AES.encrypt(word(plaintext), key, {
        mode: cryptoJs.mode.ECB, padding: cryptoJs.pad.Pkcs7,
    }).ciphertext);
    const aesDecrypt = (key, ciphertext) => bytes(cryptoJs.AES.decrypt({ ciphertext: word(ciphertext) }, key, {
        mode: cryptoJs.mode.ECB, padding: cryptoJs.pad.Pkcs7,
    }));
    const hmac = async (key, value) => {
        const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', imported, value));
    };
    const sign = async (timestamp, nonce) => base64(await hmac(encoder.encode(SIGN_KEY), encoder.encode(String(timestamp) + nonce)));
    const collectCookies = async response => {
        const headers = response.headers;
        const cookies = new Set([
            ...(typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []),
            headers.get('set-cookie') || '', headers.get('x-folia-set-cookie') || '',
        ]);
        for (const header of cookies) {
            for (const raw of header.split(/,(?=\s*[A-Za-z_][A-Za-z_0-9]*=)/)) {
                const pair = raw.split(';', 1)[0].trim();
                if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(pair)) await mergeCookies(pair);
            }
        }
    };
    const send = async (url, body, headers, stage) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetcher(url, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', ...headers },
                body: new URLSearchParams(body).toString(), redirect: 'manual', signal: controller.signal,
            });
            if (response.status >= 300 && response.status < 400) {
                throw new NeteaseXeapiError(`NetEase XEAPI ${stage} redirected unexpectedly (HTTP ${response.status})`, 502, stage);
            }
            const bodyBytes = new Uint8Array(await response.arrayBuffer());
            if (response.status >= 500) throw new NeteaseXeapiError(`NetEase XEAPI ${stage} returned HTTP ${response.status}`, response.status, stage);
            await collectCookies(response);
            return { status: response.status, bytes: bodyBytes };
        } catch (error) {
            if (error instanceof NeteaseXeapiError) throw error;
            throw new NeteaseXeapiError(`NetEase XEAPI ${stage} transport failed`, 502, stage);
        } finally { clearTimeout(timer); }
    };
    let publicKeyPromise;
    const bootstrap = async () => {
        const nonce = Array.from(random(16), value => String(value % 10)).join('');
        const timestamp = String(Date.now());
        const answer = await send('https://interface.music.163.com/api/bsr/sk/get', {
            appVersion: '9.5.61', currentKeyVersion: '', deviceId, nonce, os: 'android', requestType: 'active',
            signature: await sign(timestamp, nonce), t1: '', t2: '', timestamp, uid: '',
        }, { 'User-Agent': USER_AGENT, Cookie: `deviceId=${encodeURIComponent(deviceId)}` }, 'bootstrap');
        const response = parseJson(answer.bytes);
        if (!response || Number(response.code) !== 200 || !response.data?.encryptedData) {
            throw new NeteaseXeapiError(`NetEase XEAPI key bootstrap failed (HTTP ${answer.status})`, answer.status >= 400 ? answer.status : 502, 'bootstrap');
        }
        const expected = await sign(response.data.timestamp, nonce);
        if (typeof response.data.signature !== 'string' || !equal(encoder.encode(expected), encoder.encode(response.data.signature))) {
            throw new NeteaseXeapiError('NetEase XEAPI key response signature mismatch', 502, 'bootstrap');
        }
        let key;
        try { key = parseJson(aesDecrypt(staticKey, unbase64(response.data.encryptedData))); } catch { /* Invalid encrypted key has no authority. */ }
        if (!key || typeof key.publicKey !== 'string' || !key.sk || key.version == null) {
            throw new NeteaseXeapiError('NetEase XEAPI key response is invalid', 502, 'bootstrap');
        }
        try {
            if (unbase64(key.publicKey).length !== 32) throw new Error();
        } catch { throw new NeteaseXeapiError('NetEase XEAPI public key is invalid', 502, 'bootstrap'); }
        return key;
    };
    return async (path, data = {}) => {
        if (typeof path !== 'string' || !path.startsWith('/api/') || /[\r\n]/.test(path)) {
            throw new NeteaseXeapiError('A NetEase API path is required', 400);
        }
        publicKeyPromise ||= bootstrap();
        const publicKeyState = await publicKeyPromise;
        const cookies = parseCookies(getCookies());
        const appver = cookies.os === 'android' && cookies.appver ? cookies.appver : '9.1.65';
        const osver = cookies.os === 'android' && cookies.osver ? cookies.osver : '16';
        const buildver = cookies.buildver || String(Date.now()).slice(0, 10);
        const uri = new URL(path, 'https://interface.music.163.com');
        const content = { ...data };
        delete content.e_r;
        const plaintext = encoder.encode(JSON.stringify({
            ...(Object.keys(content).length ? { content: new URLSearchParams(content).toString() } : {}),
            queryString: uri.search ? `${uri.search.slice(1)}&e_r=true` : 'e_r=true',
        }));
        const dynamicKey = random(16);
        const inner = aesEncrypt(staticKey, plaintext);
        const mask = random(16);
        const xored = inner.map((value, index) => value ^ mask[index & 15]);
        const rotation = xored.length ? (mask[0] & 15) % xored.length : 0;
        const c = aesEncrypt(word(dynamicKey), concat(mask, xored.subarray(rotation), xored.subarray(0, rotation)));
        const peer = await crypto.subtle.importKey('raw', unbase64(publicKeyState.publicKey), { name: 'X25519' }, false, []);
        const ephemeral = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
        const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
        const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, ephemeral.privateKey, 256));
        const prk = await hmac(new Uint8Array(32), shared);
        const aesKey = (await hmac(prk, concat(ephemeralRaw, Uint8Array.of(1)))).subarray(0, 16);
        const gcmKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['encrypt']);
        const iv = random(12);
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, gcmKey,
            encoder.encode(`${base64(dynamicKey)}|android|${publicKeyState.sk}`)));
        const headerCookies = { ...cookies, os: 'android', osver, appver, buildver, deviceId, sDeviceId: cookies.sDeviceId || deviceId };
        const answer = await send(`https://interface3.music.163.com/xeapi/${uri.pathname.slice(5)}`, {
            C: base64(c).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            S: base64(concat(ephemeralRaw, iv, sealed)),
            R: base64(aesEncrypt(staticKey, encoder.encode(`${publicKeyState.version}|`))),
        }, {
            'User-Agent': USER_AGENT, 'X-Client-Enc-State': 'ENCRYPTED', 'x-aeapi': 'true',
            'x-deviceid': deviceId, 'x-os': 'android', 'x-osver': osver, 'x-appver': appver,
            'x-sdeviceid': headerCookies.sDeviceId, 'x-buildver': buildver,
            ...(cookies.MUSIC_U ? { 'x-music-u': cookies.MUSIC_U } : {}),
            Cookie: Object.entries(headerCookies).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '),
        }, 'request');
        const plainJson = parseJson(answer.bytes);
        if (plainJson) return plainJson;
        let decoded;
        try {
            let plaintextBytes = aesDecrypt(responseKey, answer.bytes);
            if (plaintextBytes[0] === 0x1f && plaintextBytes[1] === 0x8b) {
                if (typeof DecompressionStream !== 'function') throw new Error();
                plaintextBytes = new Uint8Array(await new Response(new Blob([plaintextBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
            }
            decoded = parseJson(plaintextBytes);
        } catch { /* Only verified JSON is returned to provider callers. */ }
        if (!decoded) throw new NeteaseXeapiError(`NetEase XEAPI returned an invalid response (HTTP ${answer.status})`, answer.status >= 400 ? answer.status : 502);
        return decoded;
    };
}

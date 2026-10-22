import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

// A real-crypto, network-free provider fixture checked against installed NetEase API 4.41.1.
const require = createRequire(import.meta.url);
const cryptoJs = require('crypto-js');
const oracle = require('@neteasecloudmusicapienhanced/api/util/crypto.js');
const STATIC_KEY = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex');
const RESPONSE_KEY = Buffer.from('e82ckenh8dichen8');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const fixturePair = generateKeyPairSync('x25519');
export const fixtureState = {
    publicKey: fixturePair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    version: 'fixture-version',
    sk: 'fixture-device-key',
};

function ecbEncrypt(key: Buffer, value: Uint8Array): Buffer {
    const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, Buffer.alloc(0));
    return Buffer.concat([cipher.update(value), cipher.final()]);
}

function ecbDecrypt(key: Buffer, value: Uint8Array): Buffer {
    const cipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, Buffer.alloc(0));
    return Buffer.concat([cipher.update(value), cipher.final()]);
}

export function encryptedResponse(payload: unknown, gzip = false): Response {
    const json = Buffer.from(JSON.stringify(payload));
    const bytes = ecbEncrypt(RESPONSE_KEY, gzip ? gzipSync(json) : json);
    // Verify the fixture against the independently installed implementation before using it.
    assert.deepEqual(oracle.xeapiResDecrypt(bytes), payload);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } });
}

export function form(init?: RequestInit): URLSearchParams {
    return new URLSearchParams(String(init?.body || ''));
}

export function bootstrapResponse(init?: RequestInit, tampered = false): Response {
    const input = form(init);
    assert.equal(input.get('signature'), oracle.xeapiSign(input.get('timestamp'), input.get('nonce')));
    assert.match(input.get('nonce') || '', /^\d{16}$/);
    assert.equal(input.get('os'), 'android');
    assert.equal(input.get('requestType'), 'active');
    const timestamp = '1800000000000';
    const encryptedData = ecbEncrypt(STATIC_KEY, Buffer.from(JSON.stringify(fixtureState))).toString('base64');
    assert.deepEqual(oracle.xeapiDecryptPublicKey(encryptedData), fixtureState);
    return Response.json({
        code: 200,
        data: {
            timestamp,
            encryptedData,
            signature: tampered ? 'invalid-response-signature' : oracle.xeapiSign(timestamp, input.get('nonce')),
        },
    });
}

// Recover the dynamic key using the fixture's private key, then undo both AES layers and the random mask.
export function decryptRequest(init: RequestInit | undefined, privateKey: KeyObject = fixturePair.privateKey) {
    const wire = form(init);
    const s = Buffer.from(wire.get('S') || '', 'base64');
    const ephemeralRaw = s.subarray(0, 32);
    const ephemeralPublicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, ephemeralRaw]), format: 'der', type: 'spki' });
    const shared = diffieHellman({ privateKey, publicKey: ephemeralPublicKey });
    const prk = createHmac('sha256', Buffer.alloc(32)).update(shared).digest();
    const aesKey = createHmac('sha256', prk).update(Buffer.concat([ephemeralRaw, Buffer.from([1])])).digest().subarray(0, 16);
    const decipher = createDecipheriv('aes-128-gcm', aesKey, s.subarray(32, 44));
    decipher.setAuthTag(s.subarray(-16));
    const sealed = Buffer.concat([decipher.update(s.subarray(44, -16)), decipher.final()]).toString('utf8').split('|');
    const dynamicKey = Buffer.from(sealed[0], 'base64');
    const masked = ecbDecrypt(dynamicKey, Buffer.from(wire.get('C') || '', 'base64url'));
    const mask = masked.subarray(0, 16);
    const rotated = masked.subarray(16);
    const rotation = rotated.length ? (mask[0] & 15) % rotated.length : 0;
    const xored = rotation ? Buffer.concat([rotated.subarray(-rotation), rotated.subarray(0, -rotation)]) : rotated;
    const inner = Buffer.from(xored.map((byte, index) => byte ^ mask[index & 15]));
    return {
        sealed,
        routeState: ecbDecrypt(STATIC_KEY, Buffer.from(wire.get('R') || '', 'base64')).toString('utf8'),
        plaintext: JSON.parse(ecbDecrypt(STATIC_KEY, inner).toString('utf8')),
    };
}

export type FixtureFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Return a fake provider transport that validates and decrypts the real XEAPI wire request. */
export function createXeapiFixtureFetch(resolve: (
    path: string,
    fields: URLSearchParams,
    headers: Headers,
) => unknown | Promise<unknown>): FixtureFetch {
    return async (input, init) => {
        const url = new URL(String(input));
        assert.equal(init?.redirect, 'manual');
        if (url.pathname === '/api/bsr/sk/get') return bootstrapResponse(init);
        assert.equal(url.hostname, 'interface3.music.163.com');
        assert.ok(url.pathname.startsWith('/xeapi/'));
        const decoded = decryptRequest(init);
        assert.deepEqual(decoded.sealed.slice(1), ['android', fixtureState.sk]);
        assert.equal(decoded.routeState, `${fixtureState.version}|`);
        const path = `/api/${url.pathname.slice('/xeapi/'.length)}`;
        const fields = new URLSearchParams(decoded.plaintext.content || '');
        const answer = await resolve(path, fields, new Headers(init?.headers));
        return answer instanceof Response ? answer : encryptedResponse(answer);
    };
}

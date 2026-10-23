import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Verifies the release worker, emitted ONNX runtime and bundled model without any remote requests.
const root = path.resolve(process.env.FOLIA_BUILD_DIR ?? 'dist');
const sample = process.env.FOLIA_ALIGNMENT_SAMPLE;
if (!sample) throw new Error('FOLIA_ALIGNMENT_SAMPLE must point to the public-domain JFK WAV fixture');
const worker = fs.readdirSync(path.join(root, 'assets')).find(name => /^alignment\.worker-.*\.js$/.test(name));
assert.ok(worker, 'Release worker is emitted');
const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Release recognition test</title>'); return; }
    const file = req.url === '/sample.wav' ? sample : path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if ((file !== sample && !file.startsWith(root + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.wav': 'audio/wav' };
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage();
    const external = [];
    await page.route('**/*', route => {
        if (!route.request().url().startsWith(base)) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    await page.goto(base);
    const started = Date.now();
    const result = await page.evaluate(async worker => {
        const bytes = await (await fetch('/sample.wav')).arrayBuffer();
        const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
        return new Promise((resolve, reject) => {
            const instance = new Worker('/assets/' + worker, { type: 'module' });
            const timeout = setTimeout(() => { instance.terminate(); reject(new Error('Recognition timeout')); }, 180_000);
            const finish = () => { clearTimeout(timeout); instance.terminate(); };
            instance.onerror = event => { finish(); reject(new Error(event.message)); };
            instance.onmessage = ({ data }) => {
                if (data.type === 'result') { finish(); resolve(data.value); }
                else if (data.type === 'error') { finish(); reject(new Error(data.message)); }
            };
            const samples = audio.getChannelData(0).slice();
            instance.postMessage({ samples, lyrics: null, language: 'auto' }, [samples.buffer]);
        });
    }, worker);
    assert.equal(result.kind, 'transcribed');
    assert.ok(result.lyrics.lines.map(line => line.fullText).join(' ').toLowerCase().includes('country'));
    assert.equal(external.length, 0, 'Bundled inference makes no external request');
    console.log(JSON.stringify({ ok: true, lines: result.lyrics.lines.length, elapsedMs: Date.now() - started, externalRequests: external.length }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

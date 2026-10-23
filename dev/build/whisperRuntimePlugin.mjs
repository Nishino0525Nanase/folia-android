import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// ONNX loads its Emscripten module dynamically: emit it verbatim instead of prebundling it as a JS dependency.
export const whisperRuntimePlugin = ({ modelRoot } = {}) => {
    const dist = path.dirname(createRequire(import.meta.url).resolve('@huggingface/transformers'));
    const model = JSON.parse(fs.readFileSync(new URL('./whisperModel.json', import.meta.url), 'utf8'));
    const modelFiles = modelRoot ? Object.entries(model.files).map(([name, hash]) => ({
        name: `models/${model.model}/${name}`, hash,
        path: path.join(modelRoot, model.model, 'resolve', model.revision, name),
    })) : [];
    const files = { wasm: 'ort-wasm-simd-threaded.jsep.wasm', mjs: 'ort-wasm-simd-threaded.jsep.mjs' };
    let serving = false;
    return {
        name: 'folia-whisper-runtime',
        configResolved(config) { serving = config.command === 'serve'; },
        buildStart() {
            if (serving) return;
            for (const file of modelFiles) {
                const source = fs.readFileSync(file.path);
                if (createHash('sha256').update(source).digest('hex') !== file.hash) throw new Error(`Invalid pinned recognition model: ${file.name}`);
                this.emitFile({ type: 'asset', fileName: file.name, source });
            }
        },
        resolveId(id) { if (id === 'virtual:folia-whisper-runtime') return '\0' + id; },
        load(id) {
            if (id !== '\0virtual:folia-whisper-runtime') return;
            return Object.entries(files).map(([key, name]) => {
                const value = serving ? JSON.stringify(`/__folia_whisper/${name}`)
                    : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'asset', name, source: fs.readFileSync(path.join(dist, name)) })}`;
                return `export const ${key} = ${value};`;
            }).join('\n');
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const file = modelFiles.find(file => `/${file.name}` === req.url?.split('?')[0]);
                if (!file) return next();
                res.setHeader('Content-Length', fs.statSync(file.path).size);
                res.setHeader('Content-Type', file.name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
                fs.createReadStream(file.path).pipe(res);
            });
            server.middlewares.use('/__folia_whisper/', (req, res, next) => {
                const name = req.url?.split('?')[0]?.replace(/^\//, '');
                if (!Object.values(files).includes(name)) return next();
                res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
                fs.createReadStream(path.join(dist, name)).pipe(res);
            });
        },
    };
};

'use strict';

/*
 * Flowt File Obfuscator
 * Required dependency: js-confuser
 * Run: npm install js-confuser
 *       node index.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, workerData } = require('worker_threads');

// ============== CONFIGURATION ==============
const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || '127.0.0.1';

const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024; // 40 MiB
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_JOBS = 2;

const OBF_OPTIONS = {
  target: 'node',
  renameVariables: true,
  renameGlobals: false,
  identifierGenerator: 'randomized',

  // Konfigurasi Flowt moderat.
  stringConcealing: true,
  stringEncoding: false,
  stringSplitting: 0.1,
  duplicateLiteralsRemoval: 0.4,
  controlFlowFlattening: 0.15,
  opaquePredicates: 0.1,
  deadCode: 0,
  movedDeclarations: true,
  objectExtraction: true,
  globalConcealing: false,
  calculator: true,
  hexadecimalNumbers: true,
  dispatcher: false
};

// ============== WORKER: OBFUSCATION ==============
// Worker memakai file yang sama agar proyek tetap hanya membutuhkan
// index.html dan index.js.
if (!isMainThread && workerData && workerData.task === 'obfuscate') {
  (async function runWorker() {
    try {
      const imported = require('js-confuser');
      const JsConfuser = imported.default || imported;

      if (!JsConfuser || typeof JsConfuser.obfuscate !== 'function') {
        throw new Error('API js-confuser tidak ditemukan. Periksa instalasinya.');
      }

      const source = workerData.source;
      const kind = workerData.kind;
      let output = source;
      let scriptCount = 0;

      if (kind === 'js') {
        const result = await JsConfuser.obfuscate(source, OBF_OPTIONS);
        output = typeof result === 'string' ? result : result.code;
        if (typeof output !== 'string') {
          throw new Error('Obfuscator tidak menghasilkan output JavaScript.');
        }
        scriptCount = 1;
      } else if (kind === 'html') {
        const transformed = await obfuscateInlineScripts(source, JsConfuser);
        output = transformed.html;
        scriptCount = transformed.count;
      } else {
        throw new Error('Jenis file tidak didukung.');
      }

      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        throw new Error('Ukuran hasil melewati batas 40 MiB.');
      }

      parentPortPost({ ok: true, output, scriptCount });
    } catch (error) {
      parentPortPost({
        ok: false,
        error: error && error.message ? error.message : 'Proses obfuscation gagal.'
      });
    }
  })();

  function parentPortPost(message) {
    require('worker_threads').parentPort.postMessage(message);
  }

  async function obfuscateInlineScripts(html, JsConfuser) {
    const pattern = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
    const matches = [];
    let match;

    while ((match = pattern.exec(html)) !== null) {
      matches.push({
        index: match.index,
        fullLength: match[0].length,
        opening: match[1],
        body: match[2],
        closing: match[3]
      });
    }

    if (matches.length === 0) {
      return { html, count: 0 };
    }

    const pieces = [];
    let cursor = 0;
    let count = 0;

    for (let i = 0; i < matches.length; i += 1) {
      const item = matches[i];
      pieces.push(html.slice(cursor, item.index));

      if (!isInlineJavaScript(item.opening) || !item.body.trim()) {
        pieces.push(item.opening + item.body + item.closing);
      } else {
        // Script di dalam HTML ditargetkan untuk browser. Opsi Flowt lainnya
        // tetap sama dengan konfigurasi JavaScript.
        const htmlOptions = Object.assign({}, OBF_OPTIONS, { target: 'browser' });
        const result = await JsConfuser.obfuscate(item.body, htmlOptions);
        const code = typeof result === 'string' ? result : result.code;

        if (typeof code !== 'string') {
          throw new Error('Gagal meng-obfuscate JavaScript di dalam HTML.');
        }

        pieces.push(item.opening + code + item.closing);
        count += 1;
      }

      cursor = item.index + item.fullLength;
    }

    pieces.push(html.slice(cursor));
    return { html: pieces.join(''), count };
  }

  function isInlineJavaScript(openingTag) {
    if (/\ssrc\s*=/i.test(openingTag)) return false;

    const typeMatch = openingTag.match(/\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!typeMatch) return true;

    const type = String(typeMatch[1] || typeMatch[2] || typeMatch[3] || '')
      .toLowerCase()
      .split(';')[0]
      .trim();

    return type === '' ||
      type === 'module' ||
      type === 'text/javascript' ||
      type === 'application/javascript' ||
      type === 'text/ecmascript' ||
      type === 'application/ecmascript';
  }

  return;
}

// ============== HTTP SERVER ==============
let activeJobs = 0;
const indexPath = path.join(__dirname, 'index.html');

function sendJson(res, statusCode, data) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function safeOutputName(rawName, kind) {
  let decoded = 'file';
  try {
    decoded = decodeURIComponent(rawName || 'file');
  } catch (error) {
    decoded = 'file';
  }

  decoded = path.basename(decoded.replace(/\\/g, '/'));
  const extension = path.extname(decoded).toLowerCase();
  let base = path.basename(decoded, extension);
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80);
  if (!base) base = 'file';

  return base + '.obfuscated.' + kind;
}

function handleObfuscation(req, res) {
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    sendJson(res, 429, { error: 'Server sedang memproses 2 file. Coba lagi setelah salah satu proses selesai.' });
    return;
  }

  activeJobs += 1;
  let finished = false;
  let worker = null;
  let receivedBytes = 0;
  let tooLarge = false;
  const chunks = [];

  function finishJob() {
    if (finished) return;
    finished = true;
    clearTimeout(jobTimer);
    activeJobs = Math.max(0, activeJobs - 1);
  }

  function fail(statusCode, message) {
    if (finished) return;
    if (worker) worker.terminate();
    sendJson(res, statusCode, { error: message });
    finishJob();
  }

  const jobTimer = setTimeout(function onJobTimeout() {
    fail(408, 'Waktu proses melewati 30 detik. Coba file yang lebih kecil atau kode yang lebih sederhana.');
  }, DOWNLOAD_TIMEOUT_MS);

  res.on('close', function onResponseClose() {
    if (!res.writableEnded) {
      if (worker) worker.terminate();
      finishJob();
    }
  });

  req.on('aborted', function onRequestAborted() {
    fail(400, 'Upload terputus sebelum selesai.');
  });

  req.on('data', function onRequestData(chunk) {
    if (finished || tooLarge) return;
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_INPUT_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      fail(413, 'Ukuran file melebihi batas 10 MiB.');
      req.resume();
      return;
    }

    chunks.push(chunk);
  });

  req.on('end', function onRequestEnd() {
    if (finished || tooLarge) return;

    const kind = String(req.headers['x-file-kind'] || '').toLowerCase();
    const method = String(req.headers['x-obfuscation-method'] || 'flowt').toLowerCase();
    const rawName = String(req.headers['x-file-name'] || 'file');

    if (method !== 'flowt') {
      fail(400, 'Metode obfuscation tidak dikenal.');
      return;
    }

    if (kind !== 'js' && kind !== 'html') {
      fail(400, 'Hanya file .js dan .html yang didukung.');
      return;
    }

    const source = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
    if (!source.trim()) {
      fail(400, 'File kosong atau tidak berisi teks.');
      return;
    }

    worker = new Worker(__filename, {
      workerData: { task: 'obfuscate', source, kind }
    });

    worker.on('message', function onWorkerMessage(result) {
      if (finished) return;

      if (!result || !result.ok) {
        fail(422, result && result.error ? result.error : 'Obfuscation gagal.');
        return;
      }

      const output = result.output;
      const outputBytes = Buffer.byteLength(output, 'utf8');
      if (outputBytes > MAX_OUTPUT_BYTES) {
        fail(413, 'Ukuran hasil melewati batas 40 MiB.');
        return;
      }

      const outputName = safeOutputName(rawName, kind);
      res.writeHead(200, {
        'Content-Type': kind === 'html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Content-Length': outputBytes,
        'Content-Disposition': 'attachment; filename="' + outputName + '"',
        'X-Obfuscated-Scripts': String(result.scriptCount || 0),
        'X-Output-Name': outputName,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(output, 'utf8', finishJob);
    });

    worker.on('error', function onWorkerError(error) {
      fail(500, error && error.message ? error.message : 'Worker obfuscation mengalami error.');
    });

    worker.on('exit', function onWorkerExit(code) {
      if (!finished && code !== 0) {
        fail(500, 'Proses obfuscation berhenti secara tidak normal.');
      }
    });
  });

  req.on('error', function onRequestError() {
    fail(400, 'Terjadi kesalahan saat menerima file.');
  });
}

const server = http.createServer(function requestHandler(req, res) {
  const requestUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    fs.readFile(indexPath, function onIndexRead(error, data) {
      if (error) {
        sendJson(res, 500, { error: 'index.html tidak ditemukan. Letakkan index.html dan index.js di folder yang sama.' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      activeJobs,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES
    });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/obfuscate') {
    handleObfuscation(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Halaman atau endpoint tidak ditemukan.' });
});

server.requestTimeout = DOWNLOAD_TIMEOUT_MS;
server.headersTimeout = 15_000;

server.listen(PORT, HOST, function onServerReady() {
  console.log('');
  console.log('  FLOWT FILE OBFUSCATOR');
  console.log('  Local: http://127.0.0.1:' + PORT);
  console.log('  Host : ' + HOST);
  console.log('  Limit: 10 MiB input / 40 MiB output / 2 jobs');
  console.log('  Stop : Ctrl + C');
  console.log('');
});

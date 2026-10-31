'use strict';

// KONFIGURASI OBFUSCATION JAVASCRIPT
// Gunakan pengaturan moderat agar hasil lebih kompatibel dan tidak terlalu berat.
const OBFUSCATOR_CONFIG = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,
  stringArray: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.7,
  stringArrayEncoding: [],
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  selfDefending: false,
  debugProtection: false,
  controlFlowFlattening: false,
  deadCodeInjection: false
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const statusBox = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const engineStatus = document.getElementById('engineStatus');

let outputUrl = null;

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.className = `status show${isError ? ' error' : ''}`;
}

function clearResult() {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  downloadBtn.removeAttribute('href');
  downloadBtn.removeAttribute('download');
  downloadBtn.classList.remove('show');
}

function getOutputName(filename, extension) {
  const baseName = filename.replace(/\.(js|html?|)$/i, '');
  return `${baseName || 'file'}-encrypted.${extension}`;
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

// HTML disimpan sebagai Base64 lalu ditampilkan kembali oleh loader mandiri.
// Ini penyamaran sederhana, bukan enkripsi yang tidak bisa dibalik.
function obfuscateHtml(source) {
  const payload = encodeBase64Utf8(source);
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loading...</title>
</head>
<body>
  <script>
    (() => {
      const payload = '${payload}';
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const html = new TextDecoder('utf-8').decode(bytes);
      document.open();
      document.write(html);
      document.close();
    })();
  <\/script>
</body>
</html>`;
}

async function processFile(file) {
  clearResult();

  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    showStatus('File terlalu besar. Maksimal ukuran file adalah 25 MB.', true);
    return;
  }

  const extension = file.name.split('.').pop().toLowerCase();
  if (!['js', 'html', 'htm'].includes(extension)) {
    showStatus('Format tidak didukung. Pilih file .js, .html, atau .htm.', true);
    return;
  }

  showStatus(`Memproses ${file.name}...`);

  try {
    const source = await file.text();
    let output;
    let outputExtension = extension === 'htm' ? 'html' : extension;

    if (extension === 'js') {
      if (!window.JavaScriptObfuscator) {
        throw new Error('Engine JavaScript belum termuat. Periksa koneksi internet lalu muat ulang halaman.');
      }

      output = window.JavaScriptObfuscator
        .obfuscate(source, OBFUSCATOR_CONFIG)
        .getObfuscatedCode();
    } else {
      output = obfuscateHtml(source);
    }

    const outputName = getOutputName(file.name, outputExtension);
    const mimeType = outputExtension === 'js' ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8';
    const blob = new Blob([output], { type: mimeType });

    outputUrl = URL.createObjectURL(blob);
    downloadBtn.href = outputUrl;
    downloadBtn.download = outputName;
    downloadBtn.classList.add('show');

    showStatus(`Berhasil diproses: ${outputName}`);

    // Coba unduh otomatis; tombol tetap tersedia sebagai alternatif.
    const autoDownload = document.createElement('a');
    autoDownload.href = outputUrl;
    autoDownload.download = outputName;
    document.body.appendChild(autoDownload);
    autoDownload.click();
    autoDownload.remove();
  } catch (error) {
    console.error(error);
    showStatus(error.message || 'Terjadi kesalahan saat memproses file.', true);
  }
}

fileInput.addEventListener('change', (event) => {
  processFile(event.target.files?.[0]);
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  processFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener('DOMContentLoaded', () => {
  engineStatus.textContent = window.JavaScriptObfuscator
    ? 'Engine JavaScript siap'
    : 'Engine JavaScript membutuhkan koneksi internet';
});

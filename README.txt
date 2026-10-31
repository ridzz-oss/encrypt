FILE OBFUSCATOR - VERCEL STATIC

Isi folder:
- index.html : tampilan aplikasi
- index.js   : konfigurasi dan proses obfuscation

CARA PAKAI:
1. Upload kedua file ke root project Vercel.
2. Deploy sebagai static site (tanpa Build Command).
3. Buka URL deployment.
4. Pilih atau jatuhkan satu file .js / .html / .htm.
5. Proses berjalan otomatis dan hasil akan diunduh.

CATATAN:
- File tidak diunggah ke server; pemrosesan dilakukan di browser.
- JavaScript menggunakan javascript-obfuscator dari jsDelivr CDN, sehingga proses .js memerlukan internet.
- HTML dibungkus sebagai Base64 loader. Ini hanya penyamaran sederhana, bukan enkripsi yang tidak bisa dibalik.
- Hasil bernama namafile-encrypted.js atau namafile-encrypted.html.
- Uji hasil sebelum dipakai di production, terutama bila file memakai module, CSP, atau path aset yang sensitif terhadap nama file.

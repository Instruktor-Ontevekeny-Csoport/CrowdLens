// Generate the QR code poster image for the upload page.
// Usage: node scripts/make-qr.mjs https://crowdlens.example.com [out.png]

import QRCode from 'qrcode'

const url = process.argv[2]
const out = process.argv[3] ?? 'crowdlens-qr.png'
if (!url) {
  console.error('Usage: node scripts/make-qr.mjs <production-url> [out.png]')
  process.exit(1)
}

await QRCode.toFile(out, url, { width: 1200, margin: 2 })
console.log(`QR for ${url} written to ${out}`)

import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
const outputDir = path.join(publicDir, 'icons');
const logo = await readFile(path.join(publicDir, 'dtc-logo.jpeg'));
const embeddedLogo = `data:image/jpeg;base64,${logo.toString('base64')}`;

await mkdir(outputDir, { recursive: true });

for (const size of [192, 512]) {
  await renderIcon(size, false);
  await renderIcon(size, true);
}

async function renderIcon(size, maskable) {
  const frame = maskable ? 52 : 28;
  const logoX = maskable ? 70 : 48;
  const logoY = maskable ? 104 : 88;
  const logoWidth = maskable ? 372 : 416;
  const logoHeight = maskable ? 196 : 219;
  const labelX = maskable ? 72 : 52;
  const accentY = maskable ? 324 : 333;
  const titleY = maskable ? 393 : 408;
  const metaY = maskable ? 434 : 449;
  const suffix = maskable ? '-maskable' : '';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" fill="#efefea"/>
      <rect x="${frame}" y="${frame}" width="${512 - frame * 2}" height="${512 - frame * 2}" fill="#fafaf7" stroke="#17191a" stroke-width="8"/>
      <image href="${embeddedLogo}" x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMidYMid meet"/>
      <rect x="${labelX}" y="${accentY}" width="118" height="14" fill="#e32020"/>
      <text x="${labelX}" y="${titleY}" fill="#17191a" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="900">E-LOCK</text>
      <text x="${labelX + 2}" y="${metaY}" fill="#5f6464" font-family="Consolas, 'Courier New', monospace" font-size="20" font-weight="700">CONTROL SYSTEM / 01</text>
    </svg>`;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(outputDir, `dtc-elock-${size}${suffix}.png`));
}

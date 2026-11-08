import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const brand = path.resolve('../web/public/brand');
const svg = fs.readFileSync(path.join(brand, 'triphub-mark.svg'), 'utf8');
const font = path.resolve('../web/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2').split(path.sep).join('/');
const b = await chromium.launch({ channel: 'msedge' });

// Transparent PNG exports of the mark at several sizes (crisp at any density).
for (const size of [192, 512, 1024, 2048]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: path.join(brand, `triphub-mark-${size}.png`), omitBackground: true });
  await p.close();
}

// Full lockup (mark + wordmark + tagline), 3200 x 2133, on the warm white used by the site.
const lock = await b.newPage({ viewport: { width: 1600, height: 1067 }, deviceScaleFactor: 2 });
await lock.setContent(`<html><head><style>
@font-face{font-family:'DM Sans';src:url(data:font/woff2;base64,${fs.readFileSync(font).toString('base64')}) format('woff2');font-weight:100 1000}
body{margin:0;background:#f8fbff;font-family:'DM Sans',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:1067px;color:#0b5d44}
h1{font-size:230px;line-height:1;margin:10px 0 0;font-weight:800;letter-spacing:-6px}
p{font-size:54px;margin:34px 0 0;color:#2c7a55;letter-spacing:1px}
</style></head><body><div style="width:640px;height:640px">${svg.replace('<svg ', '<svg width="640" height="640" ')}</div><h1>TripHub</h1><p>Discover more. Experience more.</p></body></html>`);
await lock.waitForTimeout(400);
await lock.screenshot({ path: path.join(brand, 'triphub-logo-hd.png') });
await b.close();

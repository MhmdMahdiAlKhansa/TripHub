import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [,, svgPath, outPng, size] = process.argv;
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: Number(size), height: Number(size) }, deviceScaleFactor: 1 });
const svg = fs.readFileSync(svgPath, 'utf8');
await p.setContent(`<html><body style="margin:0;background:#fff"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body></html>`);
await p.screenshot({ path: outPng });
await b.close();

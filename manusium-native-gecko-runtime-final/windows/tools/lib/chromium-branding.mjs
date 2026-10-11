import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

// Patch only project-owned branding surfaces. Never rewrite copyright/license
// notices, protocol names (chrome://), or Chromium's build target names.
export function applyChromiumBranding(source, brandingRoot) {
  const theme = path.join(source, 'chrome/app/theme/chromium');
  const icon = path.join(theme, 'win/chromium.ico');
  if (!fs.existsSync(icon)) throw new Error('Chromium Windows icon layout changed: win/chromium.ico missing');
  for (const name of ['chromium.ico', 'chromium_doc.ico', 'chromium_pdf.ico']) {
    const target = path.join(theme, 'win', name);
    if (fs.existsSync(target)) fs.copyFileSync(path.join(brandingRoot, 'icon.ico'), target);
  }
  const svg = fs.readFileSync(path.join(brandingRoot, 'logo.svg'), 'utf8');
  // Cover upstream's 24/64/etc. sizes too, not just the app's icon-size list.
  for (const name of fs.readdirSync(theme)) {
    const match = /^product_logo_(\d+)\.png$/.exec(name);
    if (match) fs.writeFileSync(path.join(theme, name), new Resvg(svg, { fitTo: { mode: 'width', value: Number(match[1]) } }).render().asPng());
  }
  if (fs.existsSync(path.join(theme, 'product_logo.svg'))) fs.writeFileSync(path.join(theme, 'product_logo.svg'), svg);
  const rewrite = (relative, transform) => {
    const file = path.join(source, relative);
    const before = fs.readFileSync(file, 'utf8');
    const after = transform(before);
    if (after === before && !before.includes('InkBrowser') && !before.includes('inkbrowser-chrome.exe')) throw new Error(`Chromium branding layout changed: ${relative}`);
    fs.writeFileSync(file, after);
  };
  rewrite('chrome/common/chrome_constants.cc', text => text.replaceAll('FPL("chrome.exe")', 'FPL("inkbrowser-chrome.exe")'));
  rewrite('chrome/install_static/chromium_install_modes.h', text => text.replace(/L"Chromium([^"\n]*)"/g, 'L"InkBrowser$1"').replace('"chromium",\n', '"inkbrowser",\n'));
  rewrite('chrome/app/chromium_strings.grd', text => text.replace(/(<message\b[^>]*>)([\s\S]*?)(<\/message>)/g, (all, open, body, close) => {
    if (/COPYRIGHT|LICENSE|CREDITS|TERMS/.test(open)) return all;
    return open + body.replace(/\bChromium\b/g, 'InkBrowser') + close;
  }));
}

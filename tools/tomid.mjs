import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import fs from 'node:fs';
import { unzipSync } from 'fflate';

const [src, outBase] = process.argv.slice(2);
let xml;
if (src.toLowerCase().endsWith('.mxl')) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(src)));
  const meta = files['META-INF/container.xml'];
  let name = Object.keys(files).find(n => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF'));
  if (meta) {
    const m = new TextDecoder().decode(meta).match(/full-path="([^"]+)"/);
    if (m && files[m[1]]) name = m[1];
  }
  xml = new TextDecoder().decode(files[name]);
} else xml = fs.readFileSync(src).toString();

const tk = new VerovioToolkit(await createVerovioModule());
const ok = tk.loadData(xml);
tk.setOptions({ scale: 40, pageWidth: 2100, adjustPageHeight: 1, footer: 'none', header: 'none' });
const svg = tk.renderToSVG(1);
fs.writeFileSync(`${outBase}.svg`, svg);
fs.writeFileSync(`${outBase}.mid`, Buffer.from(tk.renderToMIDI(), 'base64'));
console.log(src, '→ load:', ok, 'pages:', tk.getPageCount(), 'notes:', (svg.match(/class="note"/g) || []).length);

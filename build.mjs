// Bundles index.html + src/* into single-file builds:
//   dist/neon-reaper.html  – standalone page, open directly in a browser
//   dist/artifact.html     – same content without the document skeleton (for hosted embedding)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="(src\/[^"]+\.css)">/g, (_, p) => `<style>\n${read(p)}\n</style>`);
html = html.replace(/<script src="(src\/[^"]+\.js)"><\/script>/g, (_, p) => {
  const js = read(p).replace(/<\/script/gi, '<\\/script');
  return `<script>\n${js}\n</script>`;
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'neon-reaper.html'), html);

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
// the artifact host supplies its own tab icon, so leave ours out of that variant
const links = (html.match(/<link [^>]*>/g) || []).filter((l) => !/rel="icon"/.test(l)).join('\n');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const artifact = `${title}\n${links}\n${style}\n${body}`;
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), artifact);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log('dist/neon-reaper.html', kb(html));
console.log('dist/artifact.html   ', kb(artifact));

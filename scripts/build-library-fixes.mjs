// Turns scripts/guides/library-fixes-<lang>.txt into extension/data/library-fixes-<lang>.json,
// which the background applies to the saved guides once (see background/libraryfixes.js).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('./guides/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => /^library-fixes-.+\.txt$/.test(f))) {
  const lang = file.replace(/^library-fixes-|\.txt$/g, '');
  const ops = [];
  const text = readFileSync(new URL(file, dir), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
  for (const block of text.split(/^=== /m).slice(1)) {
    const nl = block.indexOf('\n');
    const head = (nl < 0 ? block : block.slice(0, nl)).trim();
    const body = nl < 0 ? '' : block.slice(nl + 1).trim();
    const [verb, ...rest] = head.split(' ');
    const arg = rest.join(' ');
    if (verb === 'add') {
      const [k, kind, name] = arg.split('|').map((s) => s.trim());
      ops.push({ op: 'add', k, kind, name, text: body });
    } else if (verb === 'replace') {
      const [from, to] = arg.split('->').map((s) => s.trim());
      ops.push({ op: 'replace', from, to });
    } else if (verb === 'section') {
      const [k, heading] = arg.split('|').map((s) => s.trim());
      ops.push({ op: 'section', k, heading, text: body });
    } else if (verb === 'relink') {
      const [k, rest2] = arg.split('|').map((s) => s.trim());
      const [line, to] = rest2.split('->').map((s) => s.trim());
      ops.push({ op: 'relink', k, line, to });
    } else if (verb === 'romaji') {
      ops.push({ op: 'romaji', k: arg.trim() });
    } else if (verb === 'name') {
      const [k, entry] = arg.split('|').map((s) => s.trim());
      ops.push({ op: 'name', k, text: entry });
    } else {
      throw new Error(`${file}: unknown directive ${verb}`);
    }
  }
  const version = 1;
  writeFileSync(new URL(`../extension/data/library-fixes-${lang}.json`, import.meta.url), JSON.stringify({ lang, version, ops }) + '\n');
  console.log(lang, ops.length, 'fixes');
}

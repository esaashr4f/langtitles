// Builds the built-in grammar guides (extension/data/grammar/<lang>.json) from scripts/grammar/<lang>.txt.
// Each guide starts with "=== <form id> | <name>" and uses the same "## " headings as written guides.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('./grammar/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
  const lang = file.replace(/\.txt$/, '');
  const forms = {};
  for (const block of readFileSync(new URL(file, dir), 'utf8').split(/^=== /m).slice(1)) {
    const nl = block.indexOf('\n');
    const [k, name] = block.slice(0, nl).split('|').map((s) => s.trim());
    if (!k.startsWith(lang + '.')) throw new Error(`${k}: wrong language`);
    if (forms[k]) throw new Error(`${k}: twice`);
    forms[k] = { name, text: block.slice(nl + 1).trim() };
  }
  // Grammar guides written for the library fixes are built in too (without the line-specific section).
  const fixes = new URL(`./guides/library-fixes-${lang}.txt`, import.meta.url);
  try {
    const text = readFileSync(fixes, 'utf8').split('\n').filter((l) => !/^#(?!#)/.test(l)).join('\n');
    for (const block of text.split(/^=== /m).slice(1)) {
      const nl = block.indexOf('\n');
      const m = /^add\s+(\S+)\s*\|\s*grammar\s*\|\s*(.+)$/.exec(block.slice(0, nl).trim());
      if (!m || forms[m[1]]) continue;
      const body = block.slice(nl + 1).replace(/^## Where you met it[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim();
      forms[m[1]] = { name: m[2].trim(), text: body };
    }
  } catch (e) {
    /* no fixes for this language */
  }
  writeFileSync(new URL(`../extension/data/grammar/${lang}.json`, import.meta.url), JSON.stringify({ lang, nativeLang: 'English', forms }) + '\n');
  console.log(lang, Object.keys(forms).length, 'guides');
}

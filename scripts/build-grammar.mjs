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
  writeFileSync(new URL(`../extension/data/grammar/${lang}.json`, import.meta.url), JSON.stringify({ lang, nativeLang: 'English', forms }) + '\n');
  console.log(lang, Object.keys(forms).length, 'guides');
}

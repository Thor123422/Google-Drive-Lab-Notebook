/* Syntax-check every server .js file and every inline UI script block. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let failures = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  const src = fs.readFileSync(file, 'utf8');

  if (file.endsWith('.js')) {
    try { new vm.Script(src, { filename: rel }); console.log('ok   ' + rel); }
    catch (e) { failures++; console.log('FAIL ' + rel + ': ' + e.message); }
    continue;
  }

  if (!file.endsWith('.html')) continue;
  const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) { console.log('--   ' + rel + ' (no inline script)'); continue; }
  blocks.forEach((m, i) => {
    // Apps Script scriptlets (<?= ... ?>) are substituted server-side, so a
    // block containing one is not valid JavaScript until the page renders.
    if (/<\?!?=?[\s\S]*?\?>/.test(m[1])) {
      console.log('--   ' + rel + ' [script ' + (i + 1) + '] (templated)');
      return;
    }
    const lineOffset = src.slice(0, m.index).split('\n').length - 1;
    try {
      new vm.Script(m[1], { filename: rel, lineOffset });
      console.log('ok   ' + rel + ' [script ' + (i + 1) + ']');
    } catch (e) {
      failures++;
      console.log('FAIL ' + rel + ' [script ' + (i + 1) + ']: ' + e.message);
    }
  });
}

console.log(failures ? `\n${failures} file(s) failed` : '\nAll files parse.');
process.exit(failures ? 1 : 0);

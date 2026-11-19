// Summarises the task results CSV for Table 18: completion rate and time per task, plus stuck notes.
// Usage: npm --prefix server run uat-summary -- docs/uat/results.csv
const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm --prefix server run uat-summary -- path/to/results.csv');
  process.exit(1);
}
// A small CSV reader that understands quoted fields (notes and quotes may contain commas).
function parse(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const [head, ...body] = parse(fs.readFileSync(file, 'utf8'));
const people = body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (s) => (Number.isNaN(s) ? 'n/a' : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`);

console.log(`${people.length} volunteers (${people.filter((p) => p.group === 'driver').length} drivers, ${people.filter((p) => p.group !== 'driver').length} non-drivers)\n`);
console.log('Task  Finished       Rate   Mean time (finished)   Fastest   Slowest');
for (let t = 1; t <= 6; t += 1) {
  const done = people.filter((p) => /^y/i.test(p[`t${t}_done`]));
  const secs = done.map((p) => Number(p[`t${t}_secs`])).filter((n) => Number.isFinite(n) && n > 0);
  console.log(`  ${t}   ${`${done.length}/${people.length}`.padEnd(13)} ${`${Math.round((done.length / (people.length || 1)) * 100)}%`.padEnd(6)} ${fmt(mean(secs)).padEnd(22)} ${fmt(Math.min(...secs)).padEnd(9)} ${fmt(Math.max(...secs))}`);
}
const all = people.flatMap((p) => [1, 2, 3, 4, 5, 6].map((t) => /^y/i.test(p[`t${t}_done`])));
console.log(`\nOverall task completion: ${Math.round((all.filter(Boolean).length / (all.length || 1)) * 100)}%`);

console.log('\nWhere people got stuck:');
for (const p of people) if (p.stuck_notes) console.log(`  ${p.volunteer}: ${p.stuck_notes}`);
console.log('\nQuotes (anonymous):');
for (const p of people) for (const k of ['quote_1', 'quote_2', 'quote_3']) if (p[k]) console.log(`  "${p[k]}"`);

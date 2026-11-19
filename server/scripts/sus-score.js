// Scores a SUS CSV (one row per volunteer: volunteer,q1..q10) and prints the figures for report 7.2.5.
// Usage: npm --prefix server run sus -- docs/uat/sus.csv
const fs = require('node:fs');

const STATEMENTS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
];

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm --prefix server run sus -- path/to/sus.csv');
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()));

const people = [];
for (const r of rows) {
  const id = r[0];
  const q = r.slice(1, 11).map(Number);
  if (q.length !== 10 || q.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
    console.error(`Skipped ${id || '(blank)'}: needs ten whole ratings from 1 to 5.`);
    continue;
  }
  // Odd statements (1,3,5,7,9) score rating - 1; even ones score 5 - rating. Total x 2.5 gives 0 to 100.
  const contribution = q.map((v, i) => (i % 2 === 0 ? v - 1 : 5 - v));
  people.push({ id, contribution, score: contribution.reduce((a, b) => a + b, 0) * 2.5 });
}
if (people.length === 0) {
  console.error('No valid rows.');
  process.exit(1);
}

const scores = people.map((p) => p.score);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = Math.sqrt(mean(scores.map((s) => (s - mean(scores)) ** 2)));
const sorted = [...scores].sort((a, b) => a - b);
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
const lo = people.reduce((a, b) => (b.score < a.score ? b : a));
const hi = people.reduce((a, b) => (b.score > a.score ? b : a));
const grade = (s) => (s >= 85 ? 'excellent' : s >= 73 ? 'good' : s >= 68 ? 'above average' : s >= 52 ? 'OK / below average' : 'poor');

console.log(`SUS results (${people.length} volunteers)\n`);
for (const p of people) console.log(`  ${p.id.padEnd(8)} ${p.score.toFixed(1).padStart(5)}`);
console.log(`\nAverage ${mean(scores).toFixed(1)} (${grade(mean(scores))}; the usual benchmark average is 68)`);
console.log(`Median  ${median.toFixed(1)}   Std dev ${sd.toFixed(1)}`);
console.log(`Lowest  ${lo.score.toFixed(1)} (${lo.id})   Highest ${hi.score.toFixed(1)} (${hi.id})`);

// A statement's score is the mean of its 0 to 4 contribution; the lowest are the worst for the app.
const perStatement = STATEMENTS.map((text, i) => ({ n: i + 1, text, mean: mean(people.map((p) => p.contribution[i])) }));
console.log('\nStatements from worst to best (mean contribution, 0 = worst, 4 = best):');
for (const s of [...perStatement].sort((a, b) => a.mean - b.mean)) console.log(`  Q${String(s.n).padEnd(2)} ${s.mean.toFixed(2)}  ${s.text}`);

/**
 * Private document storage. Nothing here is ever reachable directly from a browser: files are read only through
 * short-lived signed links that the API itself issues (`/api/documents/:id?exp=...&sig=...`).
 *
 * LocalStorage writes under a private folder outside the repo (`PRIVATE_DOCS_DIR`). To use Google Cloud Storage or
 * Firebase Storage in production, write another class with the same four methods (put, read, delete, signedUrl)
 * and return it from `provider()`. The rest of the app does not change.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { config } = require('../config/env');

const URL_TTL_SECONDS = 5 * 60;

let secret = null;
function signingSecret() {
  if (secret) return secret;
  secret = process.env.DOC_SIGNING_SECRET || crypto.randomBytes(32).toString('hex'); // random per boot is fine: links last 5 minutes
  return secret;
}

const sign = (docId, exp, who) => crypto.createHmac('sha256', signingSecret()).update(`${docId}.${exp}.${who}`).digest('hex');

class LocalStorage {
  constructor(root) {
    this.root = root;
  }

  async put(key, buffer) {
    const file = path.join(this.root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { mode: 0o600 });
  }

  read(key) {
    return fs.readFile(path.join(this.root, key));
  }

  async delete(key) {
    await fs.rm(path.join(this.root, key), { force: true });
  }

  /** A link to the file that works for 5 minutes, for one named viewer. */
  signedUrl(docId, who, now = Date.now()) {
    const exp = Math.floor(now / 1000) + URL_TTL_SECONDS;
    return { url: `/api/documents/${docId}?exp=${exp}&who=${who}&sig=${sign(docId, exp, who)}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** True only for a link that was issued by us, for this file, and has not run out. */
  verify(docId, { exp, who, sig }, now = Date.now()) {
    if (!/^\d+$/.test(String(exp)) || !sig || !who) return false;
    if (Number(exp) * 1000 < now) return false;
    const expected = Buffer.from(sign(docId, exp, who));
    const given = Buffer.from(String(sig));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
}

let instance = null;
function provider() {
  if (!instance) instance = new LocalStorage(config.privateDocsDir || path.join(os.homedir(), '.ridemate-private-docs'));
  return instance;
}

/** Tests point storage at a temporary folder. */
function useStorage(p) {
  instance = p;
}

module.exports = { provider, useStorage, LocalStorage, URL_TTL_SECONDS };

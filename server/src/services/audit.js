const crypto = require('node:crypto');
const { canonicalJson } = require('../lib/canonicalJson');
const { pool } = require('../db/pool');

const GENESIS_HASH = '0'.repeat(64);
// Arbitrary constant key; serialises chain appends across all connections.
const AUDIT_LOCK_KEY = 727_001;

/** The exact set of fields covered by the hash. Order is irrelevant (canonical JSON). */
function hashPayload(entry) {
  return {
    user_id: entry.user_id ?? null,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    ip_address: entry.ip_address ?? null,
    details: entry.details ?? {},
    created_at: new Date(entry.created_at).toISOString(),
  };
}

function computeEntryHash(prevHash, entry) {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonicalJson(hashPayload(entry)))
    .digest('hex');
}

/** "::ffff:127.0.0.1" → "127.0.0.1"; anything unparsable → null. */
function normaliseIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '');
}

/**
 * Appends one entry to the audit chain. Must be called with a client that is already
 * inside a transaction, so the audit row commits atomically with the change it records.
 */
async function appendAudit(client, { userId = null, action, entity, entityId = null, ipAddress = null, details = {} }) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);

  // host(inet) gives us the exact text form Postgres will return later, so verify() hashes the same string.
  const { rows } = await client.query(
    `SELECT (SELECT entry_hash FROM audit_log ORDER BY audit_id DESC LIMIT 1) AS prev_hash,
            host($1::inet) AS ip`,
    [normaliseIp(ipAddress)],
  );
  const prevHash = rows[0].prev_hash || GENESIS_HASH;

  const entry = {
    user_id: userId,
    action,
    entity,
    entity_id: entityId === null ? null : String(entityId),
    ip_address: rows[0].ip,
    details: JSON.parse(JSON.stringify(details ?? {})), // JSON-safe copy, matches what jsonb stores
    created_at: new Date(), // ms precision; round-trips through timestamptz exactly
  };
  const entryHash = computeEntryHash(prevHash, entry);

  const inserted = await client.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, ip_address, details, created_at, prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING audit_id`,
    [entry.user_id, entry.action, entry.entity, entry.entity_id, entry.ip_address, entry.details, entry.created_at, prevHash, entryHash],
  );
  return { auditId: Number(inserted.rows[0].audit_id), entryHash };
}

/**
 * Recomputes the whole chain in audit_id order.
 * @returns {{ valid: boolean, checked: number, firstBroken: null | { auditId, reason, expected, actual } }}
 */
async function verifyAuditChain(db = pool, { batchSize = 1000 } = {}) {
  let expectedPrev = GENESIS_HASH;
  let lastId = 0;
  let checked = 0;

  for (;;) {
    const { rows } = await db.query(
      `SELECT audit_id, user_id, action, entity, entity_id, host(ip_address) AS ip_address,
              details, created_at, prev_hash, entry_hash
         FROM audit_log WHERE audit_id > $1 ORDER BY audit_id LIMIT $2`,
      [lastId, batchSize],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const auditId = Number(row.audit_id);
      if (row.prev_hash !== expectedPrev) {
        return {
          valid: false,
          checked,
          firstBroken: { auditId, reason: 'prev_hash_mismatch', expected: expectedPrev, actual: row.prev_hash },
        };
      }
      const recomputed = computeEntryHash(row.prev_hash, row);
      if (recomputed !== row.entry_hash) {
        return {
          valid: false,
          checked,
          firstBroken: { auditId, reason: 'entry_hash_mismatch', expected: recomputed, actual: row.entry_hash },
        };
      }
      expectedPrev = row.entry_hash;
      lastId = auditId;
      checked += 1;
    }
  }
  return { valid: true, checked, firstBroken: null };
}

module.exports = { appendAudit, verifyAuditChain, computeEntryHash, GENESIS_HASH };

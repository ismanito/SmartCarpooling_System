const { pool } = require('../db/pool');
const { config } = require('../config/env');
const { sendMail } = require('./mailer');

/**
 * Creates an in-app notification and, for the important ones, queues an email.
 * Pass the transaction client so the notification commits with the change it describes;
 * the email goes out only after the commit.
 */
async function notify(db, { userId, type, message, link = null, email = false }) {
  await db.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)', [userId, type, message, link]);
  if (!email) return;
  const send = async () => {
    const { rows } = await pool.query('SELECT university_email FROM users WHERE user_id = $1', [userId]);
    if (rows[0]) await sendMail({ to: rows[0].university_email, subject: `RideMate: ${message.slice(0, 60)}`, text: `${message}\n\n${link ? `Open RideMate: ${config.appUrl}${link}` : ''}` });
  };
  if (typeof db.afterCommit === 'function') db.afterCommit(send);
  else Promise.resolve().then(send).catch(() => {});
}

async function notifyMany(db, userIds, payload) {
  for (const userId of new Set(userIds)) await notify(db, { ...payload, userId });
}

async function adminIds(db) {
  const { rows } = await db.query(`SELECT user_id FROM users WHERE role = 'admin' AND status = 'active'`);
  return rows.map((r) => r.user_id);
}

module.exports = { notify, notifyMany, adminIds };

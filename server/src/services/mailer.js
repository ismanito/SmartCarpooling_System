const nodemailer = require('nodemailer');
const { config } = require('../config/env');

let transporter = null;

/** SMTP from env vars; without SMTP_HOST, emails are logged to the console instead. */
function getTransporter() {
  if (transporter !== null) return transporter;
  const { host, port, user, pass } = config.smtp;
  transporter = host ? nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined }) : false;
  return transporter;
}

async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    if (!config.isTest) console.log(`[email not sent, SMTP not set] to=${to} subject="${subject}"\n${text}`);
    return { sent: false };
  }
  await t.sendMail({ from: config.smtp.from, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail };

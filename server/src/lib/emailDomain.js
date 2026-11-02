/** Returns the lower-cased domain part of an email, or null if it has none. */
function emailDomain(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** Exact domain match only: "usiu.ac.ke" does not admit "mail.usiu.ac.ke" or "usiu.ac.ke.evil.com". */
function isAllowedEmail(email, allowedDomains) {
  const domain = emailDomain(email);
  return domain !== null && allowedDomains.includes(domain);
}

module.exports = { emailDomain, isAllowedEmail };

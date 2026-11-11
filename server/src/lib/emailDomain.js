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

/** Exact address match against the configured staff/admin list (a real, non-university email). */
function isAdminEmail(email, adminEmails = []) {
  return typeof email === 'string' && adminEmails.includes(email.trim().toLowerCase());
}

/** A student domain, one of the listed admin addresses, or (when driver sign-up is on) any other address. */
function canUseApp(email, allowedDomains, adminEmails = [], allowDriverSignup = false) {
  if (isAllowedEmail(email, allowedDomains) || isAdminEmail(email, adminEmails)) return true;
  return allowDriverSignup && emailDomain(email) !== null;
}

/** Who an email address belongs to: 'admin', 'student', 'driver' (applies to drive), or null (not allowed). */
function emailKind(email, { allowedEmailDomains = [], adminEmails = [], allowDriverSignup = false } = {}) {
  if (isAdminEmail(email, adminEmails)) return 'admin';
  if (isAllowedEmail(email, allowedEmailDomains)) return 'student';
  return allowDriverSignup && emailDomain(email) !== null ? 'driver' : null;
}

module.exports = { emailDomain, isAllowedEmail, isAdminEmail, canUseApp, emailKind };

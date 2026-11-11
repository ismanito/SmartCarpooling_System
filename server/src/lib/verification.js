/**
 * Driver verification rules. Pure functions: no database, no clock (callers pass `now`), so every rule is unit-tested.
 *
 * Statuses: not_started -> pending_review -> approved | rejected -> (expired | suspended)
 */

const DRIVER_TYPES = ['student', 'staff', 'external'];

const STATUSES = ['not_started', 'pending_review', 'approved', 'rejected', 'expired', 'suspended'];

/** Who may move a verification from one status to another. */
const TRANSITIONS = {
  not_started: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  rejected: ['pending_review'], // fix and resubmit
  approved: ['expired', 'suspended'],
  expired: ['pending_review'], // reapply
  suspended: ['approved', 'expired'], // an admin reinstates, or the documents have run out meanwhile
};
const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const TYPE_LABEL = { student: 'Student driver', staff: 'Staff driver', external: 'Verified external driver' };

// ---------------------------------------------------------------- what must be provided

const BASE_DOCS = ['licence_front', 'licence_back', 'selfie', 'selfie_head_turn', 'car_front_plate', 'car_back', 'car_interior', 'insurance'];
const TYPE_DOCS = {
  student: ['student_id'],
  staff: ['staff_id'],
  external: ['national_id_front', 'national_id_back', 'good_conduct', 'psv_badge', 'inspection_report'],
};

/** Documents that must be on file before a driver can submit. Ownership proof depends on whose car it is. */
function requiredDocs(type, ownerRelationship) {
  const ownership = ownerRelationship && ownerRelationship !== 'self' ? 'owner_letter' : 'logbook';
  return [...TYPE_DOCS[type], ...BASE_DOCS, ownership];
}

const BASE_DETAILS = ['licence_number', 'licence_holder_name', 'licence_expiry', 'licence_held_since', 'insurance_provider', 'insurance_policy_no', 'insurance_expiry', 'vehicle_id', 'owner_relationship'];
const EXTERNAL_DETAILS = ['national_id_last4', 'good_conduct_issued', 'psv_badge_no', 'psv_badge_expiry', 'inspection_date', 'inspected_by'];
const requiredDetails = (type) => (type === 'external' ? [...BASE_DETAILS, ...EXTERNAL_DETAILS] : BASE_DETAILS);

/** What an admin ticks off. Each item is marked pass or fail, with a note. */
const COMMON_CHECKLIST = ['identity_matches_selfie', 'names_match', 'licence_valid', 'licence_held_long_enough', 'vehicle_matches_plate', 'ownership_shown', 'insurance_valid'];
const TYPE_CHECKLIST = {
  student: ['student_id_valid'],
  staff: ['staff_id_valid'],
  external: ['national_id_valid', 'good_conduct_valid', 'psv_badge_valid', 'inspection_report_valid', 'insurance_covers_passengers', 'in_person_check_done'],
};
const checklistFor = (type) => [...COMMON_CHECKLIST, ...TYPE_CHECKLIST[type]];

// ---------------------------------------------------------------- dates

const toDate = (d) => (d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00Z`));
const startOfDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const addDays = (d, n) => new Date(toDate(d).getTime() + n * 86_400_000);
const addMonths = (d, n) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

/** Whole years between two dates, counting only completed years. */
function yearsBetween(from, to) {
  const a = toDate(from);
  const b = toDate(to);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) years -= 1;
  return years;
}

const isPast = (date, now) => date != null && toDate(date) < startOfDay(now);
/** A date counts as expired the day after it. */
const isExpired = isPast;

/** The dates that run out, by name. */
function expiryDates(v) {
  const out = { licence: v.licence_expiry, insurance: v.insurance_expiry };
  if (v.driver_type === 'external') out.psv_badge = v.psv_badge_expiry;
  if (v.driver_type !== 'external' && v.id_expiry) out.university_id = v.id_expiry;
  return out;
}

/** Items whose date has passed. */
const expiredItems = (v, now) => Object.entries(expiryDates(v)).filter(([, d]) => d != null && isExpired(d, now)).map(([k]) => k);

/** Items that run out within `days` days but have not yet. */
function expiringItems(v, now, days) {
  const limit = addDays(startOfDay(now), days);
  return Object.entries(expiryDates(v))
    .filter(([, d]) => d != null && !isExpired(d, now) && toDate(d) <= limit)
    .map(([item, d]) => ({ item, date: String(d instanceof Date ? d.toISOString() : d).slice(0, 10) }));
}

/** A Certificate of Good Conduct must have been issued in the last 6 months. */
const goodConductFresh = (issued, now) => issued != null && toDate(issued) >= addMonths(startOfDay(now), -6) && toDate(issued) <= now;

// ---------------------------------------------------------------- what is missing before submit

/**
 * @returns {string[]} plain-language list of what is still needed; empty when ready to submit.
 */
function missingForSubmit(v, docs, { now = new Date(), minLicenceYears = 1 } = {}) {
  const missing = [];
  if (!v.consent_at) missing.push('Agree to the consent notice');
  for (const f of requiredDetails(v.driver_type)) if (v[f] == null || v[f] === '') missing.push(`Fill in ${f.replace(/_/g, ' ')}`);
  const have = new Set(docs.filter((d) => !d.deleted_at).map((d) => d.doc_type));
  for (const d of requiredDocs(v.driver_type, v.owner_relationship)) if (!have.has(d)) missing.push(`Upload ${d.replace(/_/g, ' ')}`);

  if (v.licence_expiry && isExpired(v.licence_expiry, now)) missing.push('Your licence has expired');
  if (v.insurance_expiry && isExpired(v.insurance_expiry, now)) missing.push('Your insurance has expired');
  if (v.licence_held_since && yearsBetween(v.licence_held_since, now) < minLicenceYears) {
    missing.push(`Your licence must have been held for at least ${minLicenceYears} year${minLicenceYears === 1 ? '' : 's'}`);
  }
  if (v.driver_type === 'external') {
    if (v.good_conduct_issued && !goodConductFresh(v.good_conduct_issued, now)) missing.push('Your Certificate of Good Conduct must be less than 6 months old');
    if (v.psv_badge_expiry && isExpired(v.psv_badge_expiry, now)) missing.push('Your PSV badge has expired');
  }
  return missing;
}

// ---------------------------------------------------------------- flags for the reviewer

/**
 * Warnings shown on the review page. They do not block anything by themselves; the checklist decides.
 * @param {{ accountName: string, hashReusedBy: string[], plateTakenBy: string|null }} context
 */
function reviewFlags(v, { accountName, hashReusedBy = [], plateTakenBy = null }, { now = new Date(), warningDays = 14, minLicenceYears = 1 } = {}) {
  const flags = [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  if (v.licence_holder_name && norm(v.licence_holder_name) !== norm(accountName)) flags.push({ code: 'name_mismatch', text: `The name on the licence (${v.licence_holder_name}) is not the account name (${accountName}).` });
  for (const [item, d] of Object.entries(expiryDates(v))) {
    if (d == null) continue;
    if (isExpired(d, now)) flags.push({ code: `${item}_expired`, text: `The ${item.replace('_', ' ')} has expired.` });
    else if (toDate(d) <= addDays(startOfDay(now), warningDays)) flags.push({ code: `${item}_expiring`, text: `The ${item.replace('_', ' ')} runs out within ${warningDays} days.` });
  }
  if (v.licence_held_since && yearsBetween(v.licence_held_since, now) < minLicenceYears) flags.push({ code: 'licence_too_new', text: `The licence has been held for less than ${minLicenceYears} year(s).` });
  if (plateTakenBy) flags.push({ code: 'plate_in_use', text: `This number plate is already registered to ${plateTakenBy}.` });
  if (hashReusedBy.length > 0) flags.push({ code: 'document_reused', text: `A file was already uploaded by another driver (${hashReusedBy.join(', ')}).` });
  if (v.driver_type === 'external' && v.good_conduct_issued && !goodConductFresh(v.good_conduct_issued, now)) flags.push({ code: 'good_conduct_old', text: 'The Certificate of Good Conduct is older than 6 months.' });
  return flags;
}

// ---------------------------------------------------------------- can they drive right now

/**
 * Whether a driver may go online and be offered rides.
 * @returns {{ ok: boolean, reason?: string }}
 */
function driveEligibility(v, { now = new Date(), externalEnabled = false } = {}) {
  if (!v) return { ok: false, reason: 'not_verified' };
  if (v.status !== 'approved') return { ok: false, reason: v.status };
  if (v.driver_type === 'external' && !externalEnabled) return { ok: false, reason: 'external_disabled' };
  const gone = expiredItems(v, now);
  if (gone.length > 0) return { ok: false, reason: `${gone[0]}_expired` };
  if (!v.vehicle_id) return { ok: false, reason: 'no_vehicle' };
  return { ok: true };
}

/** What a checklist must look like before approval: every item has its latest result recorded as a pass. */
function checklistComplete(type, latestByItem) {
  const needed = checklistFor(type);
  const failed = needed.filter((i) => latestByItem[i] !== 'pass');
  return { ok: failed.length === 0, failed };
}

module.exports = {
  DRIVER_TYPES,
  STATUSES,
  TYPE_LABEL,
  canTransition,
  requiredDocs,
  requiredDetails,
  checklistFor,
  checklistComplete,
  yearsBetween,
  isExpired,
  expiredItems,
  expiringItems,
  expiryDates,
  goodConductFresh,
  missingForSubmit,
  reviewFlags,
  driveEligibility,
  addDays,
  addMonths,
  startOfDay,
};

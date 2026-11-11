const { Router } = require('express');
const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { errors } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validateBody, uuidParam } = require('../middleware/validate');
const { appendAudit } = require('../services/audit');
const { MAX_PAYERS, splitEvenly } = require('../lib/payments');
const payments = require('../repositories/payments');
const { notify } = require('../services/notify');

const router = Router();
router.use(requireAuth(), requireRole('student', 'driver'));

function paymentToApi(row, shares, userId) {
  return {
    paymentId: row.payment_id,
    bookingId: row.booking_id,
    totalKes: row.amount_kes,
    paidKes: row.paid_kes,
    status: row.status,
    seats: row.seats,
    trip: { origin: row.origin_name, destination: row.destination_name, departAt: row.depart_at },
    tripStatus: row.offer_status,
    rider: { fullName: row.rider_name },
    driver: { fullName: row.driver_name },
    isBooker: row.rider_id === userId,
    shares: shares
      .filter((s) => s.payment_id === row.payment_id)
      .map((s) => ({
        shareId: s.share_id,
        payerName: s.payer_name,
        // Only the person who booked the ride sees who they invited, so they can edit the split.
        email: row.rider_id === userId && s.payer_id !== userId ? s.payer_email : undefined,
        amountKes: s.amount_kes,
        status: s.status,
        method: s.method,
        paidAt: s.paid_at,
        mine: s.payer_id === userId,
      })),
  };
}

/** Everything the rider dashboard needs: fares I booked, fares friends asked me to share, and my totals. */
router.get('/mine', async (req, res) => {
  const rows = await payments.listForPayer(req.user.userId);
  const shares = await payments.sharesFor(rows.map((r) => r.payment_id));
  const list = rows.map((r) => paymentToApi(r, shares, req.user.userId));
  const mine = list.flatMap((p) => p.shares.filter((s) => s.mine));
  const sum = (status) => mine.filter((s) => s.status === status).reduce((n, s) => n + s.amountKes, 0);
  res.json({ payments: list, summary: { owedKes: sum('pending'), paidKes: sum('paid') } });
});

/** The driver's side: what each passenger owes for the seats on their trips. */
router.get('/earnings', async (req, res) => {
  const rows = (await payments.listForDriver(req.user.userId)).filter((r) => r.status !== 'cancelled');
  const shares = await payments.sharesFor(rows.map((r) => r.payment_id));
  const list = rows.map((r) => paymentToApi(r, shares, req.user.userId));
  const collectedKes = list.reduce((n, p) => n + p.paidKes, 0);
  const totalKes = list.reduce((n, p) => n + p.totalKes, 0);
  res.json({ payments: list, summary: { collectedKes, pendingKes: totalKes - collectedKes } });
});

const splitSchema = z
  .object({ emails: z.array(z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'))).max(MAX_PAYERS - 1) })
  .strict();

/** The rider splits one fare evenly with other RideMate students (or sets it back to paying alone). */
router.post('/bookings/:id/split', uuidParam('id'), validateBody(splitSchema), async (req, res) => {
  await withTransaction(async (client) => {
    const payment = await payments.findByBookingForUpdate(client, req.params.id);
    if (!payment || payment.rider_id !== req.user.userId) throw errors.notFound('Payment not found.');
    if (payment.status !== 'pending') throw errors.conflict('PAYMENT_CLOSED', `This fare is already ${payment.status}.`);
    if ((await payments.countPaidShares(client, payment.payment_id)) > 0) {
      throw errors.conflict('SHARE_ALREADY_PAID', 'Someone has already paid their share, so the split can no longer change.');
    }

    const emails = [...new Set(req.body.emails)].filter((e) => e !== req.user.profile.university_email);
    const found = await payments.findStudentsByEmail(client, emails);
    const missing = emails.filter((e) => !found.some((u) => u.university_email === e));
    if (missing.length > 0) {
      throw errors.badRequest('VALIDATION_ERROR', 'Some fields are invalid.', [
        { field: 'emails', message: `Not an active RideMate student: ${missing.join(', ')}` },
      ]);
    }

    let amounts;
    try {
      amounts = splitEvenly(payment.amount_kes, found.length + 1);
    } catch (err) {
      throw errors.badRequest('VALIDATION_ERROR', err.message);
    }
    const payers = [req.user.userId, ...found.map((u) => u.user_id)];
    await payments.replaceShares(client, payment.payment_id, payers.map((payerId, i) => ({ payerId, amountKes: amounts[i] })));
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'payment.split',
      entity: 'payment',
      entityId: payment.payment_id,
      ipAddress: req.ip,
      details: { people: payers.length, total_kes: payment.amount_kes },
    });
  });
  res.status(204).end();
});

const paySchema = z
  .object({
    method: z.enum(['mpesa', 'cash'], { message: 'Choose how you paid' }),
    reference: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine((v) => v.method !== 'mpesa' || /^[A-Z0-9]{8,12}$/i.test(v.reference || ''), {
    path: ['reference'],
    message: 'Enter the M-Pesa confirmation code (8 to 12 letters and numbers)',
  });

/**
 * Records one share as paid. RideMate does not move money itself yet: the payer settles with the driver
 * (M-Pesa or cash) and records it here, and the driver can see it straight away.
 */
router.post('/shares/:id/pay', uuidParam('id'), validateBody(paySchema), async (req, res) => {
  await withTransaction(async (client) => {
    const share = await payments.findShareForUpdate(client, req.params.id);
    if (!share || share.payer_id !== req.user.userId) throw errors.notFound('Payment not found.');
    if (share.payment_status === 'cancelled') throw errors.conflict('PAYMENT_CLOSED', 'This ride was cancelled, so there is nothing to pay.');
    if (share.status !== 'pending') throw errors.conflict('SHARE_CLOSED', `This share is already ${share.status}.`);

    await payments.markSharePaid(client, share.share_id, {
      method: req.body.method,
      reference: req.body.reference ? req.body.reference.toUpperCase() : null,
    });
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'payment.pay',
      entity: 'payment_share',
      entityId: share.share_id,
      ipAddress: req.ip,
      details: { method: req.body.method, amount_kes: share.amount_kes },
    });
  });
  res.status(204).end();
});

/** The driver confirms a rider's share as paid (the money moved by cash or M-Pesa outside the app). */
router.post('/shares/:id/settle', uuidParam('id'), async (req, res) => {
  await withTransaction(async (client) => {
    const share = await payments.findShareForUpdate(client, req.params.id);
    if (!share || share.driver_id !== req.user.userId) throw errors.notFound('Payment not found.');
    if (share.payment_status === 'cancelled') throw errors.conflict('PAYMENT_CLOSED', 'This ride was cancelled, so there is nothing to settle.');
    if (share.status !== 'pending') throw errors.conflict('SHARE_CLOSED', `This share is already ${share.status}.`);
    await payments.markSharePaid(client, share.share_id, { method: 'cash', settledBy: req.user.userId });
    await appendAudit(client, {
      userId: req.user.userId,
      action: 'payment.settle',
      entity: 'payment_share',
      entityId: share.share_id,
      ipAddress: req.ip,
      details: { amount_kes: share.amount_kes, payer_id: share.payer_id },
    });
    await notify(client, { userId: share.payer_id, type: 'payment.settled', message: `Your driver confirmed your KES ${share.amount_kes} share as paid.`, link: '/' });
  });
  res.status(204).end();
});

module.exports = router;

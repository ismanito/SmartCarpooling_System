const { z } = require('zod');
const { haversineKm } = require('../lib/places');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MIN_AHEAD_MS = 5 * 60_000;
const MAX_AHEAD_MS = 30 * 86_400_000;

const place = (what) =>
  z
    .object({
      lat: z.number({ message: `Choose ${what}` }).min(-90).max(90),
      lng: z.number({ message: `Choose ${what}` }).min(-180).max(180),
      label: z.string().trim().min(1, `Name ${what}`).max(120),
    })
    .strict();

const pointOnly = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().optional() }).strict();

const createSchema = z
  .object({
    type: z.enum(['now', 'scheduled'], { message: 'Choose Ride Now or Book' }),
    pickup: place('a pick-up point'),
    dropoff: place('where you are going'),
    seats: z.number().int().min(1, 'At least 1 seat').max(2, 'At most 2 seats').default(1),
    scheduledFor: z.iso.datetime({ offset: true, message: 'Choose a pick-up time' }).optional(),
    repeatDays: z.array(z.enum(DAYS)).min(1).max(7).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (haversineKm(v.pickup, v.dropoff) < 0.1) ctx.addIssue({ code: 'custom', path: ['dropoff'], message: 'Pick-up and drop-off must be different places' });
    if (v.type === 'now' && (v.scheduledFor || v.repeatDays)) ctx.addIssue({ code: 'custom', path: ['type'], message: 'Ride Now has no pick-up time' });
    if (v.type === 'scheduled') {
      if (!v.scheduledFor) return ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Choose a pick-up time' });
      const ms = new Date(v.scheduledFor).getTime() - Date.now();
      if (ms < MIN_AHEAD_MS) ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Book at least 5 minutes ahead' });
      if (ms > MAX_AHEAD_MS) ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Book within the next 30 days' });
    }
  });

const estimateSchema = z.object({ pickup: pointOnly, dropoff: pointOnly }).strict();

const editSchema = z
  .object({
    scheduledFor: z.iso.datetime({ offset: true }),
    repeatDays: z.array(z.enum(DAYS)).min(1).max(7).optional(),
    series: z.boolean().optional(),
  })
  .strict()
  .refine((v) => new Date(v.scheduledFor).getTime() - Date.now() >= MIN_AHEAD_MS, { path: ['scheduledFor'], message: 'Book at least 5 minutes ahead' });

const cancelSchema = z.object({ series: z.boolean().optional() }).strict();

const onlineSchema = z.object({ vehicleId: z.uuid().optional(), selfieCheckId: z.uuid().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const locationSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), heading: z.number().min(0).max(360).nullish() })
  .strict();

const rateSchema = z
  .object({
    rateeId: z.uuid(),
    stars: z.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    tags: z.array(z.enum(['On time', 'Safe driving', 'Friendly', 'Clean car', 'Easy pick-up'])).max(5).optional(),
    comment: z.string().trim().max(300).optional(),
  })
  .strict();

module.exports = { DAYS, createSchema, estimateSchema, editSchema, cancelSchema, onlineSchema, locationSchema, rateSchema };

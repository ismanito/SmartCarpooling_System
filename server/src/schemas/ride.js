const { z } = require('zod');
const { findPlace } = require('../lib/places');

const MAX_DAYS_AHEAD = 30;

const RATING_TAGS = ['On time', 'Safe driving', 'Friendly', 'Clean car', 'Easy pick-up'];

const placeId = (label) =>
  z
    .string({ message: `Choose a ${label}` })
    .trim()
    .min(1, `Choose a ${label}`)
    .refine((id) => findPlace(id) !== null, `Choose a ${label} from the list`);

const departAt = z.coerce
  .date({ message: 'Choose a departure time' })
  .refine((d) => d.getTime() > Date.now(), 'Departure time must be in the future')
  .refine((d) => d.getTime() < Date.now() + MAX_DAYS_AHEAD * 86_400_000, `Departure must be within ${MAX_DAYS_AHEAD} days`);

const seats = (label) =>
  z.coerce
    .number({ message: `Choose ${label}` })
    .int('Seats must be a whole number')
    .min(1, 'At least 1 seat')
    .max(7, 'At most 7 seats');

const differentPlaces = (v) => v.origin !== v.destination;
const differentPlacesIssue = { path: ['destination'], message: 'Pick-up and drop-off must be different places' };

const createOfferSchema = z
  .object({
    vehicleId: z.uuid('Choose one of your vehicles'),
    origin: placeId('starting point'),
    destination: placeId('destination'),
    departAt,
    originBuilding: z.string().trim().min(1).optional(),
    destinationBuilding: z.string().trim().min(1).optional(),
    seats: seats('the seats you are offering'),
  })
  .strict()
  .refine(differentPlaces, differentPlacesIssue);

const createRequestSchema = z
  .object({
    origin: placeId('pick-up point'),
    destination: placeId('drop-off point'),
    departAt,
    originBuilding: z.string().trim().min(1).optional(),
    destinationBuilding: z.string().trim().min(1).optional(),
    seats: seats('how many seats you need'),
  })
  .strict()
  .refine(differentPlaces, differentPlacesIssue);

const createBookingSchema = z
  .object({
    offerId: z.uuid('Invalid ride offer'),
    requestId: z.uuid('Invalid ride request'),
  })
  .strict();

const ratingSchema = z
  .object({
    stars: z.coerce.number().int('Choose 1 to 5 stars').min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    comment: z.string().trim().max(300, 'Keep your comment under 300 characters').optional(),
    tags: z.array(z.enum(RATING_TAGS)).max(5).optional(),
  })
  .strict();

module.exports = { RATING_TAGS, createOfferSchema, createRequestSchema, createBookingSchema, ratingSchema };

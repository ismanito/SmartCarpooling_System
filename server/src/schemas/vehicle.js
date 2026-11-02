const { z } = require('zod');

/** "kda 123a" / "KDA-123A" → "KDA123A" */
const plateNumber = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{3,10}$/, 'Enter a valid number plate, e.g. KDA 123A'));

const makeModel = z.string().trim().min(2, 'Enter the make and model').max(80);
const colour = z.string().trim().min(2, 'Enter the colour').max(30);
const seatCapacity = z.coerce
  .number()
  .int('Seats must be a whole number')
  .min(1, 'At least 1 passenger seat')
  .max(7, 'At most 7 passenger seats');

const createVehicleSchema = z.object({ makeModel, plateNumber, colour, seatCapacity }).strict();

const updateVehicleSchema = z
  .object({
    makeModel: makeModel.optional(),
    plateNumber: plateNumber.optional(),
    colour: colour.optional(),
    seatCapacity: seatCapacity.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

module.exports = { createVehicleSchema, updateVehicleSchema };

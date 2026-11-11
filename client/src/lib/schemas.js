import { z } from 'zod'

// Client-side mirrors of the server's zod schemas, so errors show before a round trip.

export const KENYAN_PHONE_RE = /^\+254[17]\d{8}$/

export function normalisePhone(value) {
  const v = String(value || '').replace(/[\s-]/g, '')
  if (v.startsWith('0')) return `+254${v.slice(1)}`
  if (v.startsWith('254')) return `+${v}`
  return v
}

export function normalisePlate(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '')
}

/** "KDA123A" → "KDA 123A" for display; anything else is left as typed. */
export function formatPlate(plate) {
  const m = /^([A-Z]{3})(\d{3})([A-Z])$/.exec(plate || '')
  return m ? `${m[1]} ${m[2]}${m[3]}` : plate
}

export const signUpSchema = z
  .object({
    email: z.string().trim().min(1, 'Enter your university email').email('Enter a valid email address'),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirmPassword: z.string().min(1, 'Re-enter your password'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your university email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const resetSchema = z.object({
  email: z.string().trim().min(1, 'Enter your university email').email('Enter a valid email address'),
})

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  phoneNumber: z
    .string()
    .trim()
    .min(1, 'Enter your phone number')
    .refine((v) => KENYAN_PHONE_RE.test(normalisePhone(v)), 'Enter a Kenyan phone number, e.g. 0712 345 678'),
  faculty: z.string().min(1, 'Choose your school'),
})

/** Admins are staff, not students, so there is no school to choose. */
export const staffProfileSchema = profileSchema.omit({ faculty: true })

/** Drivers are not students: they give the details an admin needs to vet them. */
export const driverProfileSchema = profileSchema.omit({ faculty: true }).extend({
  licenceNumber: z.string().trim().min(4, 'Enter your driving licence number').max(30),
  idNumber: z.string().trim().min(5, 'Enter your national ID or passport number').max(20),
  about: z.string().trim().max(1000, 'Keep this under 1000 characters').optional(),
})

export const vehicleSchema = z.object({
  makeModel: z.string().trim().min(2, 'Enter the make and model').max(80),
  plateNumber: z
    .string()
    .trim()
    .min(1, 'Enter the number plate')
    .refine((v) => /^[A-Z0-9]{3,10}$/.test(normalisePlate(v)), 'Enter a valid number plate, e.g. KDA 123A'),
  colour: z.string().trim().min(2, 'Enter the colour').max(30),
  seatCapacity: z.coerce.number({ message: 'Choose the seat capacity' }).int().min(1, 'Choose the seat capacity').max(7),
})

// ---------------------------------------------------------------- rides

const futureLocalTime = z
  .string()
  .min(1, 'Choose a departure time')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Choose a departure time')
  .refine((v) => new Date(v).getTime() > Date.now(), 'Departure time must be in the future')
  .refine((v) => new Date(v).getTime() < Date.now() + 30 * 86_400_000, 'Departure must be within 30 days')

const tripShape = {
  origin: z.string().min(1, 'Choose a pick-up point'),
  destination: z.string().min(1, 'Choose a destination'),
  originBuilding: z.string().optional(),
  destinationBuilding: z.string().optional(),
  departAt: futureLocalTime,
  seats: z.coerce.number().int().min(1, 'At least 1 seat').max(7, 'At most 7 seats'),
}

const samePlaceCheck = (v) => v.origin !== v.destination
const samePlaceIssue = { path: ['destination'], message: 'Pick-up and drop-off must be different places' }

export const rideRequestSchema = z.object(tripShape).refine(samePlaceCheck, samePlaceIssue)

export const rideOfferSchema = z
  .object({ ...tripShape, vehicleId: z.string().min(1, 'Choose one of your vehicles') })
  .refine(samePlaceCheck, samePlaceIssue)

/** "2026-11-04T08:00" from a datetime-local input (local time) → ISO string. */
export function localToIso(value) {
  return new Date(value).toISOString()
}

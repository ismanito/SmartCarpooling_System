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

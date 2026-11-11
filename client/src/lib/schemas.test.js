import { describe, it, expect } from 'vitest'
import {
  signUpSchema,
  loginSchema,
  profileSchema,
  staffProfileSchema,
  driverProfileSchema,
  vehicleSchema,
  normalisePhone,
  normalisePlate,
  formatPlate,
  KENYAN_PHONE_RE, rideRequestSchema, rideOfferSchema, localToIso } from './schemas.js'

describe('normalisePhone', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254-110-345678', '+254110345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected)
  })
})

describe('KENYAN_PHONE_RE', () => {
  it.each([
    ['+254712345678', true],
    ['+254110345678', true],
    ['+14155550100', false],
    ['0812345678', false],
  ])('%s → %s', (input, expected) => {
    expect(KENYAN_PHONE_RE.test(input)).toBe(expected)
  })
})

describe('normalisePlate', () => {
  it.each([
    ['kda 123a', 'KDA123A'],
    ['KDA-123A', 'KDA123A'],
    ['kda123a', 'KDA123A'],
  ])('%s → %s', (input, expected) => {
    expect(normalisePlate(input)).toBe(expected)
  })
})

describe('formatPlate', () => {
  it.each([
    ['KDA123A', 'KDA 123A'],
    ['kda123a', 'kda123a'],
    ['ABC12', 'ABC12'],
  ])('%s → %s', (input, expected) => {
    expect(formatPlate(input)).toBe(expected)
  })
})

describe('signUpSchema', () => {
  it('accepts valid sign-up data', async () => {
    const result = await signUpSchema.safeParseAsync({
      email: 'jane@usiu.ac.ke',
      password: 'password123',
      confirmPassword: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects mismatched passwords', async () => {
    const result = await signUpSchema.safeParseAsync({
      email: 'jane@usiu.ac.ke',
      password: 'password123',
      confirmPassword: 'different',
    })
    expect(result.success).toBe(false)
  })

  it('rejects short passwords', async () => {
    const result = await signUpSchema.safeParseAsync({
      email: 'jane@usiu.ac.ke',
      password: 'short',
      confirmPassword: 'short',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('accepts valid login data', async () => {
    const result = await loginSchema.safeParseAsync({
      email: 'jane@usiu.ac.ke',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing email', async () => {
    const result = await loginSchema.safeParseAsync({
      email: '',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })
})

describe('profileSchema', () => {
  it('accepts valid profile data', async () => {
    const result = await profileSchema.safeParseAsync({
      fullName: 'Jane Doe',
      phoneNumber: '0712 345 678',
      faculty: 'School of Science and Technology',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-Kenyan phone', async () => {
    const result = await profileSchema.safeParseAsync({
      fullName: 'Jane Doe',
      phoneNumber: '+14155550100',
      faculty: 'Other',
    })
    expect(result.success).toBe(false)
  })
})

describe('vehicleSchema', () => {
  it('accepts valid vehicle data', async () => {
    const result = await vehicleSchema.safeParseAsync({
      makeModel: 'Toyota Corolla',
      plateNumber: 'kda 123a',
      colour: 'Silver',
      seatCapacity: 4,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid seat capacity', async () => {
    const result = await vehicleSchema.safeParseAsync({
      makeModel: 'Toyota Corolla',
      plateNumber: 'KDA123A',
      colour: 'Silver',
      seatCapacity: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('ride form schemas', () => {
  const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString()
  const trip = { origin: 'usiu', destination: 'cbd', departAt: inMinutes(60), seats: 2 }

  it('accepts a valid request and offer', () => {
    expect(rideRequestSchema.safeParse(trip).success).toBe(true)
    expect(rideOfferSchema.safeParse({ ...trip, vehicleId: 'abc' }).success).toBe(true)
  })

  it.each([
    ['a past time', { departAt: inMinutes(-5) }, 'departAt'],
    ['a time too far ahead', { departAt: inMinutes(60 * 24 * 40) }, 'departAt'],
    ['the same start and end', { destination: 'usiu' }, 'destination'],
    ['no pick-up', { origin: '' }, 'origin'],
    ['too many seats', { seats: 8 }, 'seats'],
  ])('rejects %s', (_, change, field) => {
    const result = rideRequestSchema.safeParse({ ...trip, ...change })
    expect(result.success).toBe(false)
    expect(result.error.issues.map((i) => i.path[0])).toContain(field)
  })

  it('requires a vehicle on an offer', () => {
    expect(rideOfferSchema.safeParse({ ...trip, vehicleId: '' }).success).toBe(false)
  })

  it('turns a local time into ISO', () => {
    expect(localToIso('2030-01-02T08:00')).toBe(new Date(2030, 0, 2, 8, 0).toISOString())
  })
})

describe('staffProfileSchema', () => {
  const base = { fullName: 'Pat Admin', phoneNumber: '0712 345 678' }

  it('does not ask admins for a school, but students still must pick one', () => {
    expect(staffProfileSchema.safeParse(base).success).toBe(true)
    expect(profileSchema.safeParse(base).success).toBe(false)
    expect(profileSchema.safeParse({ ...base, faculty: 'Law' }).success).toBe(true)
  })
})

describe('driverProfileSchema', () => {
  const base = { fullName: 'Dan Driver', phoneNumber: '0712 345 678' }

  it('needs a licence and ID number but no school', () => {
    expect(driverProfileSchema.safeParse(base).success).toBe(false)
    expect(driverProfileSchema.safeParse({ ...base, licenceNumber: 'DL-123456', idNumber: '12345678' }).success).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  signUpSchema,
  loginSchema,
  profileSchema,
  vehicleSchema,
  normalisePhone,
  normalisePlate,
  formatPlate,
  KENYAN_PHONE_RE,
} from './schemas.js'

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

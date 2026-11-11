const { z } = require('zod');

/**
 * Kenyan mobile/landline numbers, normalised to E.164:
 * "0712 345 678", "254712345678", "+254-712-345678" → "+254712345678"
 */
const kenyanPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('0') ? `+254${v.slice(1)}` : v.startsWith('254') ? `+${v}` : v))
  .pipe(z.string().regex(/^\+254[17]\d{8}$/, 'Enter a Kenyan phone number, e.g. 0712 345 678'));

const fullName = z.string().trim().min(2, 'Enter your full name').max(120);
const faculty = z.string().trim().min(2, 'Choose your school').max(120);

const createProfileSchema = z.object({ fullName, phoneNumber: kenyanPhone, faculty }).strict();
// Admins are staff, not students, so they have no school.
const createStaffProfileSchema = z.object({ fullName, phoneNumber: kenyanPhone, faculty: faculty.optional() }).strict();

const updateProfileSchema = z
  .object({ fullName: fullName.optional(), phoneNumber: kenyanPhone.optional(), faculty: faculty.optional() })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

// Drivers are not students: instead of a school they give the details an admin needs to vet them.
const licenceNumber = z.string().trim().min(4, 'Enter your driving licence number').max(30);
const idNumber = z.string().trim().min(5, 'Enter your national ID or passport number').max(20);
const about = z.string().trim().max(1000, 'Keep this under 1000 characters').optional();

const createDriverProfileSchema = z.object({ fullName, phoneNumber: kenyanPhone, licenceNumber, idNumber, about }).strict();
const driverApplicationSchema = z.object({ licenceNumber, idNumber, about }).strict();

const checkDomainSchema = z.object({ email: z.string().trim().min(3).max(254) });

module.exports = { createDriverProfileSchema, driverApplicationSchema, createProfileSchema, createStaffProfileSchema, updateProfileSchema, checkDomainSchema, kenyanPhone };

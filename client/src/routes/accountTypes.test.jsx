import { MemoryRouter } from 'react-router'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SignUpChoose from './SignUpChoose.jsx'
import { ACCOUNT_TYPES } from './SignUp.jsx'

describe('account types', () => {
  it('students and staff need a university email, drivers need any other email, admins need the admin list', () => {
    expect(ACCOUNT_TYPES.student.allows('student', false)).toBe(true)
    expect(ACCOUNT_TYPES.student.allows('driver', false)).toBe(false)
    expect(ACCOUNT_TYPES.student.allows('admin', false)).toBe(false)

    expect(ACCOUNT_TYPES.driver.allows('driver', false)).toBe(true)
    expect(ACCOUNT_TYPES.driver.allows('student', false)).toBe(false) // a real university address cannot be a driver
    expect(ACCOUNT_TYPES.driver.allows('student', true)).toBe(true) // a demo address can, so demos need no inbox
    expect(ACCOUNT_TYPES.driver.allows(null, false)).toBe(false)

    expect(ACCOUNT_TYPES.admin.allows('admin', false)).toBe(true)
    expect(ACCOUNT_TYPES.admin.allows('driver', false)).toBe(false)
  })

  it('the sign-up chooser offers student or staff, driver and the admin link', () => {
    render(
      <MemoryRouter>
        <SignUpChoose />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /Student or staff/ })).toHaveAttribute('href', '/signup/student')
    expect(screen.getByRole('link', { name: /Driver/ })).toHaveAttribute('href', '/signup/driver')
    expect(screen.getByRole('link', { name: 'Administrator sign-up' })).toHaveAttribute('href', '/signup/admin')
  })
})

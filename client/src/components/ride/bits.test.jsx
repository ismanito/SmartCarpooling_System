import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Avatar, BigPlate, Stars, kes, minutesUntil, nearestLabel } from './bits.jsx'

describe('ride bits', () => {
  it('formats shillings', () => {
    expect(kes(1250)).toBe('KES 1,250')
    expect(kes(undefined)).toBe('KES 0')
  })

  it('counts minutes until a time and never goes negative', () => {
    const now = Date.parse('2026-11-11T10:00:00Z')
    expect(minutesUntil('2026-11-11T10:07:00Z', now)).toBe(7)
    expect(minutesUntil('2026-11-11T09:50:00Z', now)).toBe(0)
    expect(minutesUntil(null, now)).toBeNull()
  })

  it('names a pinned spot after the nearest known place, or says it is pinned', () => {
    const places = [
      { id: 'a', name: 'Roysambu', lat: -1.2185, lng: 36.8892 },
      { id: 'b', name: 'Hidden', lat: -1.2, lng: 36.8, hidden: true },
    ]
    expect(nearestLabel(-1.2186, 36.8893, places)).toBe('Roysambu')
    expect(nearestLabel(-1.3, 36.9, places)).toBe('Pinned location')
  })

  it('shows initials, a big plate and a rating', () => {
    render(
      <div>
        <Avatar name="Dan Mwangi" />
        <BigPlate plate="KDM452Z" />
        <Stars value={4.5} />
        <Stars value={0} />
      </div>,
    )
    expect(screen.getByText('DM')).toBeInTheDocument()
    expect(screen.getByText('KDM 452Z')).toBeInTheDocument()
    expect(screen.getByText('4.5')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })
})

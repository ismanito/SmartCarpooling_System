import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { PlacePicker } from './PlacePicker.jsx'

const places = [
  { id: 'usiu-gate-a', name: 'USIU-Africa, Gate A', campus: true },
  { id: 'usiu-gate-b', name: 'USIU-Africa, Gate B', campus: true },
  { id: 'usiu', name: 'USIU-Africa campus', hidden: true },
  { id: 'westlands', name: 'Westlands' },
  { id: 'roysambu', name: 'Roysambu' },
]
const buildings = [{ id: 'science-centre', name: 'Science Centre' }, { id: 'library', name: 'Library' }]

function Harness({ onValue }) {
  const [value, setValue] = useState({ place: '', building: '' })
  return (
    <PlacePicker
      label="Drop-off point"
      places={places}
      buildings={buildings}
      value={value}
      onChange={(v) => {
        setValue(v)
        onValue(v)
      }}
    />
  )
}

describe('PlacePicker', () => {
  it('finds an area as you type', async () => {
    const user = userEvent.setup()
    render(<Harness onValue={() => {}} />)
    await user.type(screen.getByRole('combobox'), 'west')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Westlands'])
  })

  it('searching USIU offers only the two gates, never the plain campus entry', async () => {
    const user = userEvent.setup()
    render(<Harness onValue={() => {}} />)
    await user.type(screen.getByRole('combobox'), 'usiu')
    expect(screen.getAllByRole('option').map((o) => o.textContent.replace('On campus', ''))).toEqual(['USIU-Africa, Gate A', 'USIU-Africa, Gate B'])
  })

  it('asks which gate, and which building if going inside', async () => {
    const user = userEvent.setup()
    let latest
    render(<Harness onValue={(v) => (latest = v)} />)
    await user.type(screen.getByRole('combobox'), 'usiu')
    await user.click(screen.getByRole('option', { name: /Gate B/ }))
    expect(latest).toEqual({ place: 'usiu-gate-b', building: '' })
    expect(screen.getByText('Which gate?')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/Which building/), 'science-centre')
    expect(latest).toEqual({ place: 'usiu-gate-b', building: 'science-centre' })
    await user.click(screen.getByLabelText('Gate A'))
    expect(latest).toEqual({ place: 'usiu-gate-a', building: 'science-centre' })
  })

  it('searching a building name jumps to it on campus', async () => {
    const user = userEvent.setup()
    let latest
    render(<Harness onValue={(v) => (latest = v)} />)
    await user.type(screen.getByRole('combobox'), 'science')
    await user.click(screen.getByRole('option', { name: /Science Centre/ }))
    expect(latest).toEqual({ place: 'usiu-gate-a', building: 'science-centre' })
  })

  it('pressing Enter picks the top result and does not submit a form', async () => {
    const user = userEvent.setup()
    let submitted = false
    let latest
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true }}>
        <Harness onValue={(v) => (latest = v)} />
      </form>,
    )
    await user.type(screen.getByRole('combobox'), 'roy{Enter}')
    expect(latest.place).toBe('roysambu')
    expect(submitted).toBe(false)
  })
})

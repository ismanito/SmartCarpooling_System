import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { api } from '../../lib/api.js'

const MAX_RESULTS = 8
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const CAMPUS_WORDS = ['usiu', 'campus', 'university', 'gate']

/**
 * Search for an area (type a name and press Search, Enter, or just pick from the list).
 * USIU-Africa is entered through Gate A or Gate B, so picking campus asks which gate, and then,
 * if you are going inside, which building (for example the Science Centre).
 *
 * value: { place: id, building: id | '' }. onChange gets the same shape.
 */
export function PlacePicker({ label, value, onChange, places, buildings = [], error, onAddPlace, placeholder = 'Search an area or any address, e.g. Westlands' }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef(null)

  const [found, setFound] = useState([]) // addresses from the address search
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const q = query.trim()
    if (!onAddPlace || q.length < 3) {
      setFound([])
      return undefined
    }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      api
        .geocode(q)
        .then((r) => live && setFound(r.places || []))
        .catch(() => live && setFound([]))
        .finally(() => live && setSearching(false))
    }, 500)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, onAddPlace])

  const selectable = useMemo(() => places.filter((p) => !p.hidden && !p.geo), [places])
  const gates = useMemo(() => selectable.filter((p) => p.campus), [selectable])
  const chosen = places.find((p) => p.id === value.place)
  const onCampus = Boolean(chosen?.campus)

  const results = useMemo(() => {
    const q = norm(query)
    const list = []
    const matchesCampus = q && CAMPUS_WORDS.some((w) => w.startsWith(q) || q.startsWith(w) || q.includes(w))
    for (const p of selectable) {
      if (!q || norm(p.name).includes(q) || (p.campus && matchesCampus)) list.push({ key: p.id, label: p.name, hint: p.campus ? 'On campus' : null, pick: { place: p.id, building: '' } })
    }
    // Searching a building name ("science") jumps straight to it, through Gate A until you choose the other gate.
    if (q) {
      for (const b of buildings) {
        if (norm(b.name).includes(q)) list.push({ key: `b-${b.id}`, label: b.name, hint: 'Inside USIU-Africa', pick: { place: gates[0]?.id ?? '', building: b.id } })
      }
    }
    const local = list.slice(0, MAX_RESULTS)
    for (const g of found) local.push({ key: g.id, label: g.name, hint: 'Address', pick: { place: g.id, building: '' }, geo: g })
    return local
  }, [query, selectable, buildings, gates, found])

  const pick = (r) => {
    if (r.geo) onAddPlace?.(r.geo)
    onChange(r.pick)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault() // never submits the form
      if (results[active]) pick(results[active])
      else setOpen(true)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const listId = `${id}-list`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>

      {chosen && !open ? (
        <div className="flex min-h-12 items-center justify-between gap-2 rounded-(--radius-control) border border-ink/30 bg-surface px-3 md:min-h-11">
          <span className="flex min-w-0 items-center gap-2 text-base text-ink">
            <MapPin size={16} aria-hidden className="shrink-0" />
            <span className="truncate">{chosen.name}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setTimeout(() => input.current?.focus(), 0)
            }}
            className="focus-ring inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm underline underline-offset-4"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex gap-2">
            <input
              ref={input}
              id={id}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-invalid={error ? true : undefined}
              value={query}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
                setActive(0)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className={`block h-12 w-full rounded-(--radius-control) border bg-surface px-3 text-base text-ink placeholder:text-ink/55 focus:outline-2 focus:outline-mint md:h-11 ${error ? 'border-error' : 'border-ink/30 hover:border-ink/60'}`}
            />
            <Button type="button" variant="secondary" size="sm" className="h-12! shrink-0 md:h-11!" onClick={() => { setOpen(true); input.current?.focus() }} aria-label={`Search ${label}`}>
              <Search size={16} aria-hidden /> Search
            </Button>
            {chosen && (
              <button type="button" aria-label="Keep the current choice" onClick={() => setOpen(false)} className="focus-ring flex size-12 shrink-0 items-center justify-center rounded-(--radius-control) hover:bg-ink/8 md:size-11">
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
          {open && (
            <ul id={listId} role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-(--radius-control) border border-ink/25 bg-surface shadow-xl">
              {results.length === 0 ? (
                <li className="px-3 py-3 text-sm text-ink/85">{searching ? 'Searching addresses…' : `Nothing found for “${query}”. Try a nearby landmark or estate name.`}</li>
              ) : (
                results.map((r, i) => (
                  // The input keeps focus (arrow keys and Enter pick), so the row itself is the click target.
                  <li
                    key={r.key}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-base ${i === active ? 'bg-paper-deep' : ''}`}
                  >
                    <span>{r.label}</span>
                    {r.hint && <span className="shrink-0 rounded-(--radius-chip) bg-ink px-1.5 text-xs text-gold">{r.hint}</span>}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      {onCampus && !open && (
        <div className="space-y-3 rounded-(--radius-control) bg-paper p-3">
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Which gate?</legend>
            <div className="flex gap-2">
              {gates.map((g) => (
                <label
                  key={g.id}
                  className={`focus-within:outline-2 focus-within:outline-mint inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-(--radius-control) border px-3 text-sm font-medium ${value.place === g.id ? 'border-ink bg-ink text-gold' : 'border-ink/30 bg-surface text-ink'}`}
                >
                  <input type="radio" name={`${id}-gate`} className="sr-only" checked={value.place === g.id} onChange={() => onChange({ place: g.id, building: value.building })} />
                  {g.name.replace('USIU-Africa, ', '')}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-building`} className="text-sm font-medium text-ink">
              Going inside? Which building <span className="font-normal text-ink/85">(optional)</span>
            </label>
            <select
              id={`${id}-building`}
              value={value.building}
              onChange={(e) => onChange({ place: value.place, building: e.target.value })}
              className="block h-12 w-full rounded-(--radius-control) border border-ink/30 bg-surface px-3 text-base text-ink focus:outline-2 focus:outline-mint md:h-11"
            >
              <option value="">Just the gate</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}

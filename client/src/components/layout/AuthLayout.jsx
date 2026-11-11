import { Outlet } from 'react-router'
import { Logo } from './Logo.jsx'
import { InstallButton } from './InstallButton.jsx'

// A real run along Thika Road towards campus.
const STOPS = ['Kahawa Sukari', 'Githurai 45', 'Roysambu', 'USIU-Africa campus']

export default function AuthLayout() {
  return (
    <div className="grid min-h-dvh md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="flex flex-col gap-6 bg-asphalt px-6 py-6 text-paper md:gap-10 md:px-10 md:py-10">
        <div className="flex items-center justify-between gap-3">
          <Logo className="self-start" />
          <InstallButton />
        </div>
        <div>
          <h1 className="font-display text-6xl leading-[0.9] font-semibold tracking-wide text-gold uppercase lg:text-8xl">
            Same road.
            <br />
            Shared seat.
          </h1>
          <p className="mt-4 max-w-sm text-base text-paper/90">
            Carpool to and from campus with verified USIU-Africa students and staff going your way, driven by drivers the RideMate team has checked.
          </p>
        </div>
        <div className="relative mt-auto hidden md:block">
          <span aria-hidden className="absolute inset-y-0 left-2 w-7 overflow-hidden rounded-full bg-black/30">
            <span className="lane-vertical road-run absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2" />
          </span>
          <ol aria-label="Example route" className="space-y-8 py-2 pl-14">
            {STOPS.map((stop, i) => (
              <li key={stop} className={`font-display text-2xl leading-none tracking-wide uppercase ${i === STOPS.length - 1 ? 'text-gold' : 'text-paper'}`}>
                {stop}
              </li>
            ))}
          </ol>
        </div>
      </aside>
      <main className="flex items-start justify-center px-4 py-8 md:items-center md:py-10">
        <Outlet />
      </main>
    </div>
  )
}

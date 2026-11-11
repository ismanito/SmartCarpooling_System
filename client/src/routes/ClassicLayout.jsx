import { Link, Outlet } from 'react-router'

/** Wraps the old trip-posting screens. They still work, but Ride Now replaces them. */
export default function ClassicLayout() {
  return (
    <div className="space-y-4">
      <p role="note" className="rounded-(--radius-control) border border-coral bg-surface p-3 text-sm text-ink">
        <strong>Classic carpool is being retired.</strong> Drivers no longer need to post trips: <Link to="/" className="font-medium underline underline-offset-4">use Ride Now or Book</Link> and we match you with a driver. These old screens stay available for now.
      </p>
      <Outlet />
    </div>
  )
}

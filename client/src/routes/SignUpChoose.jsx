import { Link } from 'react-router'
import { Car, GraduationCap, ShieldCheck } from 'lucide-react'
import { Panel, PageTitle } from '../components/ui/Panel.jsx'

const CARDS = [
  {
    to: '/signup/student',
    icon: GraduationCap,
    title: 'Student or staff',
    text: 'Get rides to and from campus. Sign up with your university email.',
  },
  {
    to: '/signup/driver',
    icon: Car,
    title: 'Driver',
    text: 'Share a journey you are already making. Any email works, and the RideMate team checks your details first.',
  },
]

/** The first step of sign-up: who are you? Each account type has its own sign-up, dashboard and menu. */
export default function SignUpChoose() {
  return (
    <Panel className="w-full max-w-md">
      <PageTitle className="mb-2">Create account</PageTitle>
      <p className="mb-5 text-sm text-ink/85">Choose the kind of account you need.</p>
      <ul className="space-y-3">
        {CARDS.map(({ to, icon: Icon, title, text }) => (
          <li key={to}>
            <Link to={to} className="focus-ring flex gap-4 rounded-(--radius-panel) border border-ink/25 bg-surface p-4 transition-colors hover:border-ink">
              <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-asphalt text-gold">
                <Icon size={22} />
              </span>
              <span>
                <span className="block font-display text-2xl leading-none font-semibold tracking-wide uppercase">{title}</span>
                <span className="mt-1 block text-sm text-ink/85">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-5 flex items-center justify-center gap-2 text-sm">
        <ShieldCheck size={16} aria-hidden />
        <Link to="/signup/admin" className="text-ink underline underline-offset-4">
          Administrator sign-up
        </Link>
      </p>
      <p className="mt-3 text-center text-sm">
        Already have an account?{' '}
        <Link to="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Panel>
  )
}

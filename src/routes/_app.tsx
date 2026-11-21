import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router"
import { testIds, type Tab } from "~/domain/test-ids"
import { getSession } from "~/functions/api"

export const Route = createFileRoute("/_app")({
  // Data loads on the server, but the screens render in the browser only. Dates and times
  // then use the phone's time zone from the first paint, instead of the server's.
  ssr: "data-only",
  beforeLoad: async () => {
    const user = await getSession()

    if (!user) throw redirect({ to: "/login" })

    return { user }
  },
  component: AppLayout,
})

const TABS = [
  { to: "/", tab: "today", label: "Today", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { to: "/plan", tab: "plan", label: "Plan", icon: "M5 4h14v3H5zM5 10.5h14v3H5zM5 17h14v3H5z" },
  { to: "/exercises", tab: "exercises", label: "Exercises", icon: "M2 9h2.5v6H2zM5.5 6.5h3v11h-3zM9.5 11h5v2h-5zM15.5 6.5h3v11h-3zM19.5 9H22v6h-2.5z" },
  { to: "/history", tab: "history", label: "History", icon: "M4 20V10h3v10zM10.5 20V4h3v16zM17 20v-7h3v7z" },
  { to: "/settings", tab: "settings", label: "Settings", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z" },
] as const satisfies ReadonlyArray<{ readonly to: string; readonly tab: Tab; readonly label: string; readonly icon: string }>

function AppLayout() {
  const location = useLocation()
  // A workout takes the whole screen so the log button is never competing with the tab bar.
  const inWorkout = location.pathname.startsWith("/workout/")

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <main className={`pt-safe px-4 ${inWorkout ? "pb-safe" : "pb-32"}`}>
        <Outlet />
      </main>
      {inWorkout ? null : (
        <nav className="bottom-safe fixed inset-x-0 z-30 px-4">
          <ul className="mx-auto flex max-w-sm gap-0.5 rounded-full border border-white/10 bg-surface/85 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {TABS.map((tab) => (
              <li key={tab.to} className="flex-1">
                <Link
                  to={tab.to}
                  data-testid={testIds.nav.tab(tab.tab)}
                  activeOptions={{ exact: tab.to === "/" }}
                  className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-semibold transition-colors"
                  activeProps={{ className: "bg-accent/12 text-accent" }}
                  inactiveProps={{ className: "text-faint" }}
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
                    <path d={tab.icon} />
                  </svg>
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}

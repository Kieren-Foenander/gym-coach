import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router"
import { getSession } from "~/functions/api"

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = await getSession()

    if (!user) throw redirect({ to: "/login" })

    return { user }
  },
  component: AppLayout,
})

const TABS = [
  { to: "/", label: "Today", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { to: "/plan", label: "Plan", icon: "M5 4h14v3H5zM5 10.5h14v3H5zM5 17h14v3H5z" },
  { to: "/history", label: "History", icon: "M4 20V10h3v10zM10.5 20V4h3v16zM17 20v-7h3v7z" },
  { to: "/settings", label: "Settings", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z" },
] as const

function AppLayout() {
  const location = useLocation()
  // A workout takes the whole screen so the log button is never competing with the tab bar.
  const inWorkout = location.pathname.startsWith("/workout/")

  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <main className={`pt-safe px-4 ${inWorkout ? "pb-safe" : "pb-28"}`}>
        <Outlet />
      </main>
      {inWorkout ? null : (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 backdrop-blur">
          <ul className="mx-auto flex max-w-md">
            {TABS.map((tab) => (
              <li key={tab.to} className="flex-1">
                <Link
                  to={tab.to}
                  activeOptions={{ exact: tab.to === "/" }}
                  className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-neutral-500"
                  activeProps={{ className: "text-accent" }}
                >
                  <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden="true">
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

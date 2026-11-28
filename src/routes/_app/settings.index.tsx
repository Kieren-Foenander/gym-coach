import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronIcon } from "~/components/icons"
import { Button, Card, PageTitle, SectionTitle } from "~/components/ui"
import { coachSummary, profileSummary, SETTINGS_TITLES, streakSummary } from "~/domain/settings"
import { testIds } from "~/domain/test-ids"
import { signOut, unsubscribePush } from "~/functions/api"
import { forgetThisBrowser } from "~/push"

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
})

/** A short menu: each row opens a page of its own and says what is set there now. */
function SettingsPage() {
  const { user } = Route.useRouteContext()

  const leave = async () => {
    await forgetThisBrowser(async (endpoint) => {
      await unsubscribePush({ data: { endpoint } })
    })
    await signOut()
    window.location.assign("/login")
  }

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <SectionTitle>You</SectionTitle>
      <Card className="py-1">
        <ul className="divide-y divide-white/5">
          <Row to="/settings/profile" page="profile" detail={profileSummary(user)} />
          <Row to="/settings/streaks" page="streaks" detail={streakSummary(user)} />
        </ul>
      </Card>

      <SectionTitle>Connections</SectionTitle>
      <Card className="py-1">
        <ul className="divide-y divide-white/5">
          <Row to="/settings/coach" page="coach" detail={coachSummary()} />
        </ul>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card>
        <p className="pb-3 text-muted">Signed in as {user.email}</p>
        <Button className="w-full" data-testid={testIds.settings.signOut} onClick={leave}>
          Sign out
        </Button>
      </Card>
    </>
  )
}

interface RowProps {
  readonly to: "/settings/profile" | "/settings/streaks" | "/settings/coach"
  readonly page: keyof typeof SETTINGS_TITLES
  readonly detail: string
}

function Row({ to, page, detail }: RowProps) {
  return (
    <li>
      <Link to={to} data-testid={testIds.settings.page(page)} className="flex min-h-16 items-center justify-between gap-3 py-2">
        <span className="min-w-0">
          <span className="block font-semibold">{SETTINGS_TITLES[page]}</span>
          <span className="block truncate text-sm text-muted">{detail}</span>
        </span>
        <ChevronIcon className="size-4 shrink-0 text-faint" />
      </Link>
    </li>
  )
}

import { createFileRoute, Link } from "@tanstack/react-router"
import { Schema } from "effect"
import { ExerciseLine, MUSCLE_COUNTS, SearchField } from "~/components/exercise"
import { Card, PageTitle, SectionTitle } from "~/components/ui"
import { CATALOG, EQUIPMENT, MUSCLES, mergeLibrary, searchLibrary, type LibraryItem } from "~/domain/catalog"
import { getExercises } from "~/functions/api"

const Search = Schema.Struct({
  q: Schema.optional(Schema.String),
  group: Schema.optional(Schema.Literals(MUSCLES)),
  equipment: Schema.optional(Schema.Literals(EQUIPMENT)),
})

export const Route = createFileRoute("/_app/exercises/")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loader: () => getExercises(),
  component: ExercisesPage,
})

const SEARCH_LIMIT = 60

function ExercisesPage() {
  const known = Route.useLoaderData()
  const { q = "", group, equipment } = Route.useSearch()
  const navigate = Route.useNavigate()
  const items = mergeLibrary(known)
  const own = items.filter((item) => item.entry === null)
  const searching = q.trim() !== ""

  // Typing replaces the address instead of adding to the history, so Back leaves the screen in one step.
  const setQuery = (text: string) =>
    void navigate({ search: (previous) => ({ ...previous, q: text === "" ? undefined : text }), replace: true })

  const inGroup = group ? items.filter((item) => item.entry?.primary.includes(group)) : []
  const offered = EQUIPMENT.filter((option) => inGroup.some((item) => item.entry?.equipment === option))
  const filtered = equipment ? inGroup.filter((item) => item.entry?.equipment === equipment) : inGroup
  const found = searching ? searchLibrary(items, q) : []

  return (
    <>
      <PageTitle eyebrow={`${CATALOG.length + own.length} in the library`}>Exercises</PageTitle>
      <SearchField value={q} placeholder="Name, muscle or equipment" onChange={setQuery} />

      {searching ? (
        <div className="pt-4">
          {found.length === 0 ? (
            <Empty>Nothing matches “{q.trim()}”. You can still add it by name from your plan or a workout.</Empty>
          ) : (
            <>
              <ExerciseRows items={found.slice(0, SEARCH_LIMIT)} />
              {found.length > SEARCH_LIMIT ? (
                <p className="pt-3 text-center text-sm text-faint">Keep typing to narrow down {found.length} matches.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {!searching && group ? (
        <>
          <div className="flex items-end justify-between gap-3 pt-5">
            <h2 className="display text-4xl">{group}</h2>
            <Link to="/exercises" className="eyebrow flex min-h-11 items-center text-accent">
              All muscles
            </Link>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4 pt-2" role="group" aria-label="Equipment">
            <Chip label="All" selected={!equipment} search={{ group }} />
            {offered.map((option) => (
              <Chip key={option} label={option} selected={equipment === option} search={{ group, equipment: option }} />
            ))}
          </div>
          <ExerciseRows items={filtered} />
        </>
      ) : null}

      {!searching && !group ? (
        <>
          <SectionTitle>By muscle</SectionTitle>
          <ul className="grid grid-cols-2 gap-2">
            {MUSCLE_COUNTS.map(({ muscle, count }) => (
              <li key={muscle}>
                <Link
                  to="/exercises"
                  search={{ group: muscle }}
                  className="flex min-h-16 items-center justify-between gap-2 rounded-2xl border border-white/5 bg-surface px-4 active:bg-raised"
                >
                  <span className="display truncate text-2xl">{muscle}</span>
                  <span className="tabular text-sm text-faint">{count}</span>
                </Link>
              </li>
            ))}
          </ul>

          {own.length > 0 ? (
            <>
              <SectionTitle>Your own</SectionTitle>
              <ExerciseRows items={own} />
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

interface ChipProps {
  readonly label: string
  readonly selected: boolean
  readonly search: typeof Search.Type
}

function Chip({ label, selected, search }: ChipProps) {
  return (
    <Link
      to="/exercises"
      search={search}
      replace
      aria-current={selected ? "true" : undefined}
      className={`flex min-h-11 shrink-0 items-center rounded-full px-4 font-semibold transition-colors ${
        selected ? "bg-accent text-accent-ink" : "bg-raised text-muted"
      }`}
    >
      {label}
    </Link>
  )
}

const ROW_STYLE = "flex min-h-16 items-center gap-3 py-2"

function ExerciseRows({ items }: { readonly items: ReadonlyArray<LibraryItem> }) {
  return (
    <Card className="py-1">
      <ul className="divide-y divide-white/5">
        {items.map((item) => (
          <li key={item.name}>
            {item.entry ? (
              <Link to="/exercises/$slug" params={{ slug: item.entry.slug }} className={ROW_STYLE}>
                <ExerciseLine item={item} />
              </Link>
            ) : item.known ? (
              <Link to="/exercise/$exerciseId" params={{ exerciseId: String(item.known.id) }} className={ROW_STYLE}>
                <ExerciseLine item={item} />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Empty({ children }: { readonly children: React.ReactNode }) {
  return <p className="rounded-3xl border border-dashed border-line px-4 py-10 text-center text-muted">{children}</p>
}

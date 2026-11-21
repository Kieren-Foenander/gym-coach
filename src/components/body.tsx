import { useState, type FormEvent } from "react"
import { TrendChart } from "~/components/chart"
import { CloseIcon } from "~/components/icons"
import { Button, Card, ErrorNote, parseNumber, SectionTitle, Stat, TextInput, useAction } from "~/components/ui"
import { MEASUREMENT_KINDS, measurementUnit, type MeasurementKind, type Unit } from "~/domain/schema"
import { formatDay, formatWeight } from "~/format"
import { deleteMeasurement, logMeasurement } from "~/functions/api"
import type { Measurement } from "~/server/repo"

const LABELS: Record<MeasurementKind, string> = {
  weight: "Bodyweight",
  bodyFat: "Body fat",
  waist: "Waist",
  chest: "Chest",
  hips: "Hips",
  arm: "Arm",
  thigh: "Thigh",
}

interface BodyLogProps {
  /** Newest first. */
  readonly measurements: ReadonlyArray<Measurement>
  readonly unit: Unit
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${formatWeight(Math.round(value * 10) / 10)}`

/** Bodyweight and tape measurements: log one, see the trend, remove a mistake. */
export function BodyLog({ measurements, unit }: BodyLogProps) {
  const { act, pending, error } = useAction()
  const [kind, setKind] = useState<MeasurementKind>("weight")
  const [value, setValue] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const entries = measurements.filter((entry) => entry.kind === kind)
  const latest = entries[0]
  const earliest = entries.at(-1)
  const kindUnit = measurementUnit(kind, unit)

  const submit = (event: FormEvent) => {
    event.preventDefault()

    const parsed = parseNumber(value)

    if (parsed === null || parsed < 1 || parsed > 1000) {
      setFormError("Enter a number between 1 and 1000")

      return
    }

    setFormError(null)

    void act(async () => {
      await logMeasurement({ data: { kind, value: parsed } })
      setValue("")
    })
  }

  return (
    <div className="pt-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Measurement">
        {MEASUREMENT_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            className={`min-h-11 shrink-0 rounded-full px-4 font-semibold transition-colors ${
              kind === option ? "bg-accent text-accent-ink" : "bg-raised text-muted"
            }`}
            onClick={() => setKind(option)}
          >
            {LABELS[option]}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 pt-4">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-sm text-muted">
            {LABELS[kind]} today ({kindUnit})
          </span>
          <TextInput
            inputMode="decimal"
            placeholder={latest ? formatWeight(latest.value) : ""}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          Log
        </Button>
      </form>
      <div className="pt-2">
        <ErrorNote message={formError ?? error} />
      </div>

      {latest && earliest ? (
        <>
          <div className="grid grid-cols-2 gap-2 pt-3">
            <Stat label={`Latest · ${formatDay(latest.measuredAt)}`} value={formatWeight(latest.value)} unit={kindUnit} />
            <Stat
              label={entries.length > 1 ? `Since ${formatDay(earliest.measuredAt)}` : "Change"}
              value={entries.length > 1 ? signed(latest.value - earliest.value) : "–"}
              unit={entries.length > 1 ? kindUnit : undefined}
            />
          </div>

          <SectionTitle>Trend</SectionTitle>
          <Card>
            <TrendChart
              label={LABELS[kind]}
              unit={kindUnit}
              points={entries.toReversed().map((entry) => ({ id: entry.id, date: entry.measuredAt, value: entry.value }))}
            />
          </Card>

          <SectionTitle>Entries</SectionTitle>
          <Card>
            <ul className="divide-y divide-white/5">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span className="text-muted">{formatDay(entry.measuredAt)}</span>
                  <span className="flex items-center gap-1">
                    <span className="tabular font-semibold">
                      {formatWeight(entry.value)} {kindUnit}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove the entry from ${formatDay(entry.measuredAt)}`}
                      className="flex size-11 items-center justify-center text-faint"
                      disabled={pending}
                      onClick={() => act(() => deleteMeasurement({ data: { measurementId: entry.id } }))}
                    >
                      <CloseIcon className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <p className="mt-4 rounded-3xl border border-dashed border-line px-4 py-10 text-center text-muted">
          Nothing logged for {LABELS[kind].toLowerCase()} yet.
        </p>
      )}
    </div>
  )
}

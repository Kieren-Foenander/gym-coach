import { useState } from "react"
import { Pressable, View } from "react-native"
import { MEASUREMENT_KINDS, measurementUnit, type MeasurementKind, type Unit } from "~/domain/units"
import { formatDay, formatWeight } from "~/format"
import type { Measurement } from "~/server/repo"
import { call } from "@/api/session"
import { CloseIcon } from "@/components/icons"
import { TrendChart } from "@/components/TrendChart"
import { Button, Card, Chip, ChipRow, Divider, Empty, ErrorNote, Field, parseNumber, SectionTitle, Stat, Text, TextInput } from "@/components/ui"
import { useAction } from "@/data/calls"
import { colors } from "@/theme"

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

  const submit = () => {
    const parsed = parseNumber(value)

    if (parsed === null || parsed < 1 || parsed > 1000) {
      setFormError("Enter a number between 1 and 1000")

      return
    }

    setFormError(null)

    void act(async () => {
      await call("logMeasurement", { kind, value: parsed })
      setValue("")
    })
  }

  return (
    <View className="pt-4">
      <ChipRow label="Measurement">
        {MEASUREMENT_KINDS.map((option) => (
          <Chip key={option} label={LABELS[option]} selected={kind === option} onPress={() => setKind(option)} />
        ))}
      </ChipRow>

      <View className="flex-row items-end gap-2 pt-4">
        <View className="flex-1">
          <Field label={`${LABELS[kind]} today (${kindUnit})`}>
            <TextInput
              keyboardType="decimal-pad"
              placeholder={latest ? formatWeight(latest.value) : ""}
              value={value}
              onChangeText={setValue}
            />
          </Field>
        </View>
        <Button variant="primary" disabled={pending} onPress={submit}>
          Log
        </Button>
      </View>
      <View className="pt-2">
        <ErrorNote message={formError ?? error} />
      </View>

      {latest && earliest ? (
        <>
          <View className="flex-row gap-2 pt-3">
            <Stat label={`Latest · ${formatDay(latest.measuredAt)}`} value={formatWeight(latest.value)} unit={kindUnit} />
            <Stat
              label={entries.length > 1 ? `Since ${formatDay(earliest.measuredAt)}` : "Change"}
              value={entries.length > 1 ? signed(latest.value - earliest.value) : "–"}
              unit={entries.length > 1 ? kindUnit : undefined}
            />
          </View>

          <SectionTitle>Trend</SectionTitle>
          <Card>
            <TrendChart
              label={LABELS[kind]}
              unit={kindUnit}
              points={entries.toReversed().map((entry) => ({ id: entry.id, date: entry.measuredAt, value: entry.value }))}
            />
          </Card>

          <SectionTitle>Entries</SectionTitle>
          <Card className="py-1">
            {entries.map((entry, index) => (
              <View key={entry.id}>
                {index > 0 ? <Divider /> : null}
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-muted">{formatDay(entry.measuredAt)}</Text>
                  <View className="flex-row items-center gap-1">
                    <Text className="font-semibold tabular-nums">
                      {formatWeight(entry.value)} {kindUnit}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove the entry from ${formatDay(entry.measuredAt)}`}
                      disabled={pending}
                      onPress={() => act(() => call("deleteMeasurement", { measurementId: entry.id }))}
                      className="size-11 items-center justify-center"
                    >
                      <CloseIcon color={colors.faint} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : (
        <View className="pt-4">
          <Empty>{`Nothing logged for ${LABELS[kind].toLowerCase()} yet.`}</Empty>
        </View>
      )}
    </View>
  )
}

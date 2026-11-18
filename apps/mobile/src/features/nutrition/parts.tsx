import { useState } from "react"
import { Pressable, View } from "react-native"
import {
  describeMacros,
  describeTarget,
  EMPTY_FOOD_FORM,
  foodFormFor,
  formatAmount,
  NUTRIENT_INFO,
  readFoodForm,
  readTarget,
  shortDay,
  targetProgress,
  type FoodEntry,
  type FoodForm,
  type Nutrient,
  type NutritionDay,
  type NutritionTargets,
} from "~/domain/nutrition"
import { call } from "@/api/session"
import { CloseIcon } from "@/components/icons"
import { Button, Card, Display, Divider, Empty, ErrorNote, Field, Text, TextInput } from "@/components/ui"
import { useAction } from "@/data/calls"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"

/** A bar filling up towards a target. Amber once it is past it. */
export function TargetBar({ value, target, label }: { readonly value: number; readonly target: number | null; readonly label: string }) {
  const progress = targetProgress(value, target)

  if (progress === null) return null

  const over = target !== null && value > target

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      className="mt-2 h-2 overflow-hidden rounded-full bg-raised"
    >
      <View className={cn("h-full rounded-full", over ? "bg-amber-300" : "bg-accent")} style={{ width: `${progress * 100}%` }} />
    </View>
  )
}

function TargetStat({ nutrient, value, target }: { readonly nutrient: Nutrient; readonly value: number; readonly target: number | null }) {
  const info = NUTRIENT_INFO[nutrient]

  return (
    <View className="rounded-2xl bg-raised/70 px-3 py-3">
      <Display numberOfLines={1} adjustsFontSizeToFit className="tabular-nums">
        {formatAmount(value)}
        <Display className="text-base text-muted">{target === null ? ` ${info.unit}` : ` / ${formatAmount(target)} ${info.unit}`}</Display>
      </Display>
      <Text numberOfLines={1} className="pt-1 text-xs text-muted">
        {info.label} · {describeTarget(nutrient, value, target)}
      </Text>
      <TargetBar value={value} target={target} label={`${info.label} against target`} />
    </View>
  )
}

/** A day's calories and macros, against the targets, saying how much came from Apple Health. */
export function DayTotals({ day, targets }: { readonly day: NutritionDay; readonly targets: NutritionTargets }) {
  return (
    <View className="gap-2">
      <TargetStat nutrient="calories" value={day.total.calories} target={targets.calories} />
      <TargetStat nutrient="protein" value={day.total.protein} target={targets.protein} />
      <View className="flex-row gap-2">
        {(["carbs", "fat"] as const).map((nutrient) => (
          <View key={nutrient} className="flex-1 rounded-2xl bg-raised/70 px-3 py-2.5">
            <Display className="text-2xl tabular-nums">
              {formatAmount(day.total[nutrient])}
              <Display className="text-base text-muted"> g</Display>
            </Display>
            <Text className="text-xs text-muted">{NUTRIENT_INFO[nutrient].label}</Text>
          </View>
        ))}
      </View>
      {day.health ? (
        <Text className="text-sm text-faint">
          Includes {formatAmount(day.health.calories)} kcal and {formatAmount(day.health.protein)} g protein from Apple Health.
        </Text>
      ) : null}
    </View>
  )
}

interface FoodEditorProps {
  readonly day: string
  /** The entry being changed, or null to add a new one. */
  readonly editing: FoodEntry | null
  readonly onDone: () => void
}

/** Adds an entry to the day, or changes one. Calories are needed; the macros are optional. */
export function FoodEditor({ day, editing, onDone }: FoodEditorProps) {
  const { act, pending, error } = useAction()
  const [form, setForm] = useState<FoodForm>(editing ? foodFormFor(editing) : EMPTY_FOOD_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = () => {
    const read = readFoodForm(form)

    if (!read.ok) {
      setFormError(read.error)

      return
    }

    setFormError(null)

    void act(async () => {
      if (editing) await call("updateFood", { foodId: editing.id, food: read.food })
      else await call("logFood", { day, food: read.food })

      setForm(EMPTY_FOOD_FORM)
      onDone()
    })
  }

  return (
    <View className="gap-3">
      <Field label="What you ate">
        <TextInput
          value={form.description}
          maxLength={200}
          placeholder="Chicken, rice and broccoli"
          onChangeText={(description) => setForm({ ...form, description })}
        />
      </Field>
      <View className="flex-row gap-2">
        {(["calories", "protein", "carbs", "fat"] as const).map((nutrient) => (
          <View key={nutrient} className="flex-1">
            <Field label={nutrient === "calories" ? "kcal" : `${NUTRIENT_INFO[nutrient].label} g`}>
              <TextInput
                keyboardType={nutrient === "calories" ? "number-pad" : "decimal-pad"}
                className="px-2 text-center tabular-nums"
                value={form[nutrient]}
                onChangeText={(value) => setForm({ ...form, [nutrient]: value })}
              />
            </Field>
          </View>
        ))}
      </View>
      <ErrorNote message={formError ?? error} />
      <View className="flex-row gap-2">
        <Button variant="primary" className="flex-1" disabled={pending} onPress={submit}>
          {editing ? "Save" : "Add food"}
        </Button>
        {editing ? (
          <Button variant="ghost" disabled={pending} onPress={onDone}>
            Cancel
          </Button>
        ) : null}
      </View>
    </View>
  )
}

interface FoodListProps {
  readonly entries: ReadonlyArray<FoodEntry>
  readonly editingId: number | null
  readonly onEdit: (entry: FoodEntry) => void
}

/** The day's entries. Tap one to change it. */
export function FoodList({ entries, editingId, onEdit }: FoodListProps) {
  const { act, pending, error } = useAction()

  if (entries.length === 0) return <Empty>Nothing logged in the app for this day.</Empty>

  return (
    <>
      <ErrorNote message={error} />
      <Card className="py-1">
        {entries.map((entry, index) => {
          const macros = describeMacros(entry)

          return (
            <View key={entry.id}>
              {index > 0 ? <Divider /> : null}
              <View className="flex-row items-center gap-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Change this entry"
                  onPress={() => onEdit(entry)}
                  className="min-h-14 flex-1 justify-center py-2"
                >
                  <Text numberOfLines={1} className={cn("font-semibold", editingId === entry.id && "text-accent")}>
                    {entry.description}
                  </Text>
                  <Text className="text-sm tabular-nums text-muted">
                    {formatAmount(entry.calories)} kcal{macros === "" ? "" : ` · ${macros}`}
                    {entry.source === "ai" ? " · Coach" : ""}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.description}`}
                  disabled={pending}
                  onPress={() => act(() => call("deleteFood", { foodId: entry.id }))}
                  className="size-11 items-center justify-center"
                >
                  <CloseIcon color={colors.faint} />
                </Pressable>
              </View>
            </View>
          )
        })}
      </Card>
    </>
  )
}

interface WeekBarsProps {
  /** Oldest first. */
  readonly days: ReadonlyArray<NutritionDay>
  readonly selected: string
  readonly target: number | null
  readonly onSelect: (day: string) => void
}

/** Calories each day of the week, as bars, with the target marked. Tap a day to show it. */
export function WeekBars({ days, selected, target, onSelect }: WeekBarsProps) {
  const top = Math.max(target ?? 0, ...days.map((day) => day.total.calories), 1)

  return (
    <Card>
      <View className="relative h-32 flex-row items-end gap-2">
        {target === null ? null : (
          <View
            pointerEvents="none"
            className="absolute inset-x-0 border-t border-dashed border-accent/50"
            style={{ bottom: `${(target / top) * 100}%` }}
          />
        )}
        {days.map((day) => (
          <Pressable
            key={day.day}
            accessibilityRole="button"
            accessibilityLabel={`${shortDay(day.day)}: ${formatAmount(day.total.calories)} kcal`}
            accessibilityState={{ selected: day.day === selected }}
            onPress={() => onSelect(day.day)}
            className="h-full flex-1 justify-end"
          >
            <View
              className={cn("w-full rounded-t-lg", day.day === selected ? "bg-accent" : "bg-line")}
              style={{ height: `${Math.max(2, (day.total.calories / top) * 100)}%` }}
            />
          </Pressable>
        ))}
      </View>
      <View className="flex-row gap-2 pt-2">
        {days.map((day) => (
          <Text key={day.day} className={cn("flex-1 text-center text-xs", day.day === selected ? "text-chalk" : "text-faint")}>
            {shortDay(day.day)}
          </Text>
        ))}
      </View>
      {target === null ? null : <Text className="pt-2 text-xs text-faint">The dashed line is your calorie target.</Text>}
    </Card>
  )
}

/** The daily calorie and protein targets. The coach can set these too. */
export function TargetsForm({ targets }: { readonly targets: NutritionTargets }) {
  const { act, pending, error } = useAction()
  const [calories, setCalories] = useState(targets.calories === null ? "" : String(targets.calories))
  const [protein, setProtein] = useState(targets.protein === null ? "" : String(targets.protein))
  const [formError, setFormError] = useState<string | null>(null)

  const submit = () => {
    const calorieTarget = readTarget("calories", calories)
    const proteinTarget = readTarget("protein", protein)

    if (!calorieTarget.ok) {
      setFormError(calorieTarget.error)

      return
    }

    if (!proteinTarget.ok) {
      setFormError(proteinTarget.error)

      return
    }

    setFormError(null)

    void act(async () => {
      await call("updateProfile", { calorieTarget: calorieTarget.value, proteinTarget: proteinTarget.value })
    })
  }

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Field label="Calories (kcal)">
            <TextInput keyboardType="number-pad" className="tabular-nums" value={calories} onChangeText={setCalories} />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Protein (g)">
            <TextInput keyboardType="number-pad" className="tabular-nums" value={protein} onChangeText={setProtein} />
          </Field>
        </View>
      </View>
      <ErrorNote message={formError ?? error} />
      <Button disabled={pending} onPress={submit}>
        Save targets
      </Button>
      <Text className="text-sm text-faint">Leave one blank for no target. Your coach can set these for you too.</Text>
    </View>
  )
}

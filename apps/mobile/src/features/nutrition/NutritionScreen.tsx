import { useState } from "react"
import { Pressable, View } from "react-native"
import { localDay } from "~/domain/health"
import { shiftDay } from "~/domain/days"
import { describeDay, nutritionDays, nutritionRange, WEEK_DAYS, type FoodEntry } from "~/domain/nutrition"
import type { CallOutput } from "~/server/calls"
import { describeError } from "@/api/client"
import { BackLink, Card, Display, Eyebrow, Loading, Screen, SectionTitle, Text } from "@/components/ui"
import { useCall } from "@/data/calls"
import { cn } from "@/lib/cn"
import { useNow } from "@/lib/useNow"
import type { AppScreenProps } from "@/navigation"
import { DayTotals, FoodEditor, FoodList, TargetsForm, WeekBars } from "./parts"

/** The food log a day at a time: totals against the targets, what was eaten, and the week around it. */
export function NutritionScreen({ navigation }: AppScreenProps<"Nutrition">) {
  const today = localDay(useNow())
  const [picked, setPicked] = useState<string | null>(null)
  const [editing, setEditing] = useState<FoodEntry | null>(null)
  // A day picked in the future (after midnight passes with the screen open, say) falls back to today.
  const day = picked !== null && picked <= today ? picked : today
  const { data, error } = useCall("getNutrition", nutritionRange(day, Date.now()))

  const show = (next: string) => {
    setEditing(null)
    setPicked(next)
  }

  return (
    <Screen>
      <BackLink onPress={navigation.goBack} />
      <Eyebrow className="min-h-4 pb-1 text-accent">{describeDay(day, today)}</Eyebrow>
      <View className="flex-row items-end justify-between gap-3 pb-5">
        <Display accessibilityRole="header" className="text-5xl">
          Food
        </Display>
        <View className="flex-row gap-1">
          <DayButton label="The day before" text="‹" onPress={() => show(shiftDay(day, -1))} />
          <DayButton label="The day after" text="›" disabled={day >= today} onPress={() => show(shiftDay(day, 1))} />
        </View>
      </View>

      {data ? (
        <FoodDay day={day} data={data} editing={editing} onEdit={setEditing} onShow={show} />
      ) : (
        <Loading error={error ? describeError(error) : null} />
      )}
    </Screen>
  )
}

interface DayButtonProps {
  readonly label: string
  readonly text: string
  readonly disabled?: boolean
  readonly onPress: () => void
}

function DayButton({ label, text, disabled = false, onPress }: DayButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn("size-11 items-center justify-center rounded-full bg-raised", disabled && "opacity-30")}
    >
      <Text className="text-xl text-muted">{text}</Text>
    </Pressable>
  )
}

interface FoodDayProps {
  readonly day: string
  readonly data: CallOutput<"getNutrition">
  readonly editing: FoodEntry | null
  readonly onEdit: (entry: FoodEntry | null) => void
  readonly onShow: (day: string) => void
}

function FoodDay({ day, data, editing, onEdit, onShow }: FoodDayProps) {
  // Worked out again here so the week always ends at the day shown, even while an older answer is showing.
  const loadedDays = new Map(data.days.map((item) => [item.day, item]))
  const days = nutritionDays(shiftDay(day, 1 - WEEK_DAYS), day, [], []).map((item) => loadedDays.get(item.day) ?? item)
  const shown = days.at(-1)!
  const entries = data.entries.filter((entry) => entry.day === day)

  return (
    <>
      <DayTotals day={shown} targets={data.targets} />

      <SectionTitle>{editing ? "Change entry" : "Log food"}</SectionTitle>
      <Card>
        <FoodEditor key={`${day}-${editing?.id ?? "new"}`} day={day} editing={editing} onDone={() => onEdit(null)} />
      </Card>
      <Text className="pt-2 text-sm text-faint">Or tell your coach what you ate, and it estimates and logs it for you.</Text>

      <SectionTitle>Eaten</SectionTitle>
      <FoodList entries={entries} editingId={editing?.id ?? null} onEdit={onEdit} onStopEditing={() => onEdit(null)} />

      <SectionTitle>Week</SectionTitle>
      <WeekBars days={days} selected={day} target={data.targets.calories} onSelect={onShow} />

      <SectionTitle>Daily targets</SectionTitle>
      <Card>
        <TargetsForm key={`${data.targets.calories}-${data.targets.protein}`} targets={data.targets} />
      </Card>
    </>
  )
}

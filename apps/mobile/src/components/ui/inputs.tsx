import * as Haptics from "expo-haptics"
import type { ReactNode } from "react"
import { Pressable, ScrollView, TextInput as NativeTextInput, View, type TextInputProps } from "react-native"
import { CloseIcon, SearchIcon } from "@/components/icons"
import { cn } from "@/lib/cn"
import { colors } from "@/theme"
import { Display, Eyebrow, Text } from "./text"

/** Reads a number typed on a phone keyboard, where the decimal key may produce a comma. */
export const parseNumber = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."))

  return text.trim() === "" || Number.isNaN(value) ? null : value
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View>
      <Text className="pb-1.5 text-sm text-muted">{label}</Text>
      {children}
    </View>
  )
}

interface InputProps extends TextInputProps {
  readonly className?: string
}

const INPUT_STYLE = "min-h-12 rounded-2xl border border-line bg-ink px-4 text-base text-chalk focus:border-accent"

export function TextInput({ className, ...props }: InputProps) {
  return (
    <NativeTextInput
      className={cn(INPUT_STYLE, className)}
      placeholderTextColor={colors.faint}
      selectionColor={colors.accent}
      keyboardAppearance="dark"
      {...props}
    />
  )
}

export function TextArea({ className, ...props }: InputProps) {
  return <TextInput multiline textAlignVertical="top" className={cn("min-h-20 py-3", className)} {...props} />
}

interface SearchFieldProps {
  readonly value: string
  readonly placeholder: string
  readonly onChange: (value: string) => void
  /** From src/domain/test-ids.ts, on the field itself. */
  readonly testID?: string
}

export function SearchField({ value, placeholder, onChange, testID }: SearchFieldProps) {
  return (
    <View className="justify-center">
      <TextInput
        testID={testID}
        accessibilityLabel="Search exercises"
        className="px-12"
        placeholder={placeholder}
        value={value}
        onChangeText={onChange}
        maxLength={80}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
      />
      <View pointerEvents="none" className="absolute left-4">
        <SearchIcon color={colors.faint} />
      </View>
      {value === "" ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
          className="absolute right-0.5 size-11 items-center justify-center"
        >
          <CloseIcon color={colors.faint} />
        </Pressable>
      )}
    </View>
  )
}

interface StepperProps {
  readonly label: string
  readonly value: string
  readonly step: number
  readonly decimal?: boolean
  readonly onChange: (value: string) => void
}

/** A number field with large minus and plus buttons either side, sized for a thumb mid-workout. */
export function Stepper({ label, value, step, decimal = false, onChange }: StepperProps) {
  const nudge = (direction: number) => {
    const next = Math.max(0, (parseNumber(value) ?? 0) + direction * step)

    void Haptics.selectionAsync()
    onChange(String(Math.round(next * 100) / 100))
  }

  return (
    <View className="flex-1">
      <Eyebrow className="pb-1.5 text-center text-xs text-faint">{label}</Eyebrow>
      <View className="flex-row items-center gap-1 rounded-2xl bg-ink p-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Less ${label}`}
          onPress={() => nudge(-1)}
          className="size-12 items-center justify-center rounded-xl bg-raised active:bg-line"
        >
          <Text className="text-2xl">−</Text>
        </Pressable>
        <NativeTextInput
          accessibilityLabel={label}
          keyboardType={decimal ? "decimal-pad" : "number-pad"}
          keyboardAppearance="dark"
          selectTextOnFocus
          selectionColor={colors.accent}
          value={value}
          onChangeText={onChange}
          className="display h-12 min-w-0 flex-1 p-0 text-center text-3xl tabular-nums text-chalk focus:text-accent"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More ${label}`}
          onPress={() => nudge(1)}
          className="size-12 items-center justify-center rounded-xl bg-raised active:bg-line"
        >
          <Text className="text-2xl">+</Text>
        </Pressable>
      </View>
    </View>
  )
}

interface SegmentedProps<T extends string> {
  readonly options: ReadonlyArray<T>
  readonly value: T
  readonly label: string
  readonly onChange: (value: T) => void
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string>({ options, value, label, onChange }: SegmentedProps<T>) {
  return (
    <View accessibilityLabel={label} className="flex-row gap-1 rounded-2xl bg-raised/70 p-1">
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option }}
          onPress={() => onChange(option)}
          className={cn("min-h-11 flex-1 items-center justify-center rounded-xl", value === option && "bg-accent")}
        >
          <Text className={cn("font-semibold capitalize", value === option ? "text-accent-ink" : "text-muted")}>{option}</Text>
        </Pressable>
      ))}
    </View>
  )
}

interface ChipProps {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}

/** One choice in a row of filters. */
export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn("min-h-11 justify-center rounded-full px-4", selected ? "bg-accent" : "bg-raised")}
    >
      <Text className={cn("font-semibold", selected ? "text-accent-ink" : "text-muted")}>{label}</Text>
    </Pressable>
  )
}

/** Chips in a row that scrolls sideways to the edges of the screen. */
export function ChipRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      accessibilityLabel={label}
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="gap-2 px-4"
    >
      {children}
    </ScrollView>
  )
}

interface EffortPickerProps {
  readonly value: number | null
  readonly onChange: (value: number | null) => void
}

const EFFORTS = [6, 7, 8, 9, 10] as const

/** How hard a set was, from 6 to 10. Tapping the chosen number again clears it. */
export function EffortPicker({ value, onChange }: EffortPickerProps) {
  return (
    <View accessibilityLabel="Effort, optional">
      <View className="flex-row items-baseline justify-between pb-1.5">
        <Eyebrow className="text-xs text-faint">Effort · optional</Eyebrow>
        <Text className="text-xs text-faint">10 = nothing left</Text>
      </View>
      <View className="flex-row gap-1 rounded-2xl bg-ink p-1">
        {EFFORTS.map((effort) => (
          <Pressable
            key={effort}
            accessibilityRole="button"
            accessibilityLabel={`Effort ${effort} out of 10`}
            accessibilityState={{ selected: value === effort }}
            onPress={() => onChange(value === effort ? null : effort)}
            className={cn("min-h-11 flex-1 items-center justify-center rounded-xl", value === effort ? "bg-accent" : "bg-raised")}
          >
            <Display className={cn("text-xl tabular-nums", value === effort ? "text-accent-ink" : "text-muted")}>{effort}</Display>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

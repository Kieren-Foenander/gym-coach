import { Children, isValidElement, type ReactNode } from "react"
import { Pressable, type PressableProps } from "react-native"
import { cn } from "@/lib/cn"
import { Text } from "./text"

const BUTTON_STYLES = {
  primary: "bg-accent active:bg-accent-strong",
  secondary: "bg-raised active:bg-line",
  ghost: "active:bg-raised",
  danger: "active:bg-red-950/40",
  outline: "border border-dashed border-line active:bg-raised",
} as const

const LABEL_STYLES = {
  primary: "display text-xl text-accent-ink",
  secondary: "font-semibold text-chalk",
  ghost: "font-semibold text-muted",
  danger: "font-semibold text-red-400",
  outline: "font-semibold text-chalk",
} as const

export type ButtonVariant = keyof typeof BUTTON_STYLES

export interface ButtonProps extends Omit<PressableProps, "children"> {
  readonly variant?: ButtonVariant
  readonly className?: string
  readonly labelClassName?: string
  /** Text becomes the label. Anything else is laid out in a row as given. */
  readonly children: ReactNode
}

export function Button({ variant = "secondary", className, labelClassName, children, disabled, ...props }: ButtonProps) {
  // Plain text, however many pieces it came in, is the label. Anything with an element in it is laid out as given.
  const isLabel = Children.toArray(children).every((child) => !isValidElement(child))

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={cn(
        "min-h-12 flex-row items-center justify-center gap-2 rounded-2xl px-5",
        BUTTON_STYLES[variant],
        disabled && "opacity-40",
        className,
      )}
      {...props}
    >
      {isLabel ? (
        <Text numberOfLines={1} className={cn(LABEL_STYLES[variant], labelClassName)}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  )
}

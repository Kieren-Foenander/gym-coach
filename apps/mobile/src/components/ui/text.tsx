import { Text as NativeText, type TextProps as NativeTextProps } from "react-native"
import { cn } from "@/lib/cn"

export interface TextProps extends NativeTextProps {
  readonly className?: string
}

/** Body text in the app's colour. Everything on screen is written with this or one of the two below. */
export function Text({ className, ...props }: TextProps) {
  return <NativeText className={cn("text-base text-chalk", className)} {...props} />
}

/** Headings and big numbers: condensed and uppercase. */
export function Display({ className, ...props }: TextProps) {
  return <NativeText className={cn("display text-3xl text-chalk", className)} {...props} />
}

/** A small uppercase label above a heading or number. */
export function Eyebrow({ className, ...props }: TextProps) {
  return <NativeText className={cn("eyebrow text-muted", className)} {...props} />
}

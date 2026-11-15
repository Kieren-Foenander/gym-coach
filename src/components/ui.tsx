import { isRedirect, useRouter } from "@tanstack/react-router"
import { CloseIcon } from "./icons"
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"

const BUTTON_BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"

const BUTTON_STYLES = {
  primary:
    "bg-accent font-display text-xl font-bold uppercase tracking-wide text-accent-ink shadow-[0_10px_30px_-12px_rgb(215_255_62/0.65)] active:bg-accent-strong",
  secondary: "bg-raised text-base font-semibold text-white active:bg-line",
  ghost: "text-base font-semibold text-muted active:bg-raised",
  danger: "text-base font-semibold text-red-400 active:bg-red-950/40",
} as const

type ButtonVariant = keyof typeof BUTTON_STYLES

/** Button styling for elements that are not buttons, such as links. */
export const buttonClass = (variant: ButtonVariant = "secondary", className = "") =>
  `${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
}

export function Button({ variant = "secondary", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />
}

export function Card({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) {
  return <section className={`rounded-3xl border border-white/5 bg-surface p-4 ${className}`}>{children}</section>
}

interface PageTitleProps {
  readonly children: ReactNode
  readonly eyebrow?: ReactNode
  readonly action?: ReactNode
}

export function PageTitle({ children, eyebrow, action }: PageTitleProps) {
  return (
    <header className="flex items-end justify-between gap-3 pb-5 pt-2">
      <div className="min-w-0">
        {eyebrow === undefined ? null : <p className="eyebrow min-h-4 pb-1 text-accent">{eyebrow}</p>}
        <h1 className="display truncate text-5xl">{children}</h1>
      </div>
      {action}
    </header>
  )
}

export function SectionTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h2 className="eyebrow flex items-center gap-2 pb-3 pt-7 text-muted">
      <span className="h-3.5 w-1 rounded-full bg-accent" aria-hidden="true" />
      {children}
    </h2>
  )
}

interface StatProps {
  readonly label: string
  readonly value: ReactNode
  readonly unit?: string
}

/** One headline number with a label under it. */
export function Stat({ label, value, unit }: StatProps) {
  return (
    <div className="rounded-2xl bg-raised/70 px-3 py-3">
      <p className="display tabular text-3xl">
        {value}
        {unit ? <span className="pl-1 text-base text-muted">{unit}</span> : null}
      </p>
      <p className="pt-1 text-xs text-muted">{label}</p>
    </div>
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
    <div className="flex gap-1 rounded-2xl bg-raised/70 p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          className={`min-h-11 flex-1 rounded-xl font-semibold capitalize transition-colors ${value === option ? "bg-accent text-accent-ink" : "text-muted"}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function ErrorNote({ message }: { readonly message: string | null }) {
  if (!message) return null

  return (
    <p role="alert" className="rounded-2xl border border-red-900/60 bg-red-950/60 px-4 py-3 text-sm text-red-200">
      {message}
    </p>
  )
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
    </label>
  )
}

const INPUT_STYLE =
  "w-full min-h-12 rounded-2xl border border-line bg-ink px-4 text-white placeholder:text-faint focus:border-accent focus:outline-none"

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT_STYLE} ${className}`} {...props} />
}

export function TextArea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${INPUT_STYLE} py-3 ${className}`} {...props} />
}

/** Reads a number typed on a phone keyboard, where the decimal key may produce a comma. */
export const parseNumber = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."))

  return text.trim() === "" || Number.isNaN(value) ? null : value
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

    onChange(String(Math.round(next * 100) / 100))
  }

  return (
    <div>
      <span className="eyebrow mb-1.5 block text-center text-xs text-faint">{label}</span>
      <div className="flex items-center gap-1 rounded-2xl bg-ink p-1">
        <button
          type="button"
          aria-label={`Less ${label}`}
          onClick={() => nudge(-1)}
          className="size-12 shrink-0 rounded-xl bg-raised text-2xl text-white transition active:scale-95 active:bg-line"
        >
          −
        </button>
        <input
          aria-label={label}
          inputMode={decimal ? "decimal" : "numeric"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.target.select()}
          className="display tabular h-12 w-full min-w-0 rounded-xl bg-transparent text-center text-3xl focus:text-accent focus:outline-none"
        />
        <button
          type="button"
          aria-label={`More ${label}`}
          onClick={() => nudge(1)}
          className="size-12 shrink-0 rounded-xl bg-raised text-2xl text-white transition active:scale-95 active:bg-line"
        >
          +
        </button>
      </div>
    </div>
  )
}

interface SheetProps {
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
}

/** A panel that slides over the bottom of the screen. */
export function Sheet({ title, onClose, children }: SheetProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 animate-fade bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="pb-safe relative mx-auto max-h-[90dvh] w-full max-w-md animate-sheet overflow-y-auto rounded-t-[2rem] border-t border-white/10 bg-surface px-4 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="display min-w-0 truncate text-3xl">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-muted"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * False until React has taken over the page. A form submitted before then
 * would be sent by the browser itself, so submit buttons wait for this.
 */
/** The current time. Null until mounted, so server and client render the same thing. Ticks each second if asked. */
export function useNow(ticking = false) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())

    if (!ticking) return

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [ticking])

  return now
}

export function useHydrated() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => setHydrated(true), [])

  return hydrated
}

/**
 * Runs a server call, then reloads the current route's data. Tracks whether
 * it is running and the last error so a screen can show both.
 */
export function useAction() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = async (work: () => Promise<void>) => {
    setPending(true)
    setError(null)

    try {
      await work()
      await router.invalidate()
    } catch (cause) {
      if (isRedirect(cause)) await router.navigate({ to: "/login" })
      else setError(cause instanceof Error ? cause.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  return { act, pending, error }
}

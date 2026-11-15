import { isRedirect, useRouter } from "@tanstack/react-router"
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"

const BUTTON_STYLES = {
  primary: "bg-accent-strong text-white active:bg-accent",
  secondary: "bg-raised text-neutral-50 active:bg-neutral-700",
  ghost: "text-neutral-300 active:bg-raised",
  danger: "text-red-400 active:bg-raised",
} as const

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: keyof typeof BUTTON_STYLES
}

export function Button({ variant = "secondary", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>
}

export function PageTitle({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-4">
      <h1 className="text-3xl font-bold tracking-tight">{children}</h1>
      {action}
    </header>
  )
}

export function SectionTitle({ children }: { readonly children: ReactNode }) {
  return <h2 className="pb-2 pt-6 text-sm font-semibold uppercase tracking-wide text-neutral-400">{children}</h2>
}

export function ErrorNote({ message }: { readonly message: string | null }) {
  if (!message) return null

  return (
    <p role="alert" className="rounded-xl bg-red-950 px-3 py-2 text-sm text-red-200">
      {message}
    </p>
  )
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

const INPUT_STYLE =
  "w-full min-h-12 rounded-xl border border-line bg-ink px-3 text-neutral-50 placeholder:text-neutral-600 focus:border-accent focus:outline-none"

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
      <span className="mb-1 block text-center text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Less ${label}`}
          onClick={() => nudge(-1)}
          className="size-12 shrink-0 rounded-xl bg-raised text-2xl text-neutral-200 active:bg-neutral-700"
        >
          −
        </button>
        <input
          aria-label={label}
          inputMode={decimal ? "decimal" : "numeric"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.target.select()}
          className="tabular h-12 w-full min-w-0 rounded-xl border border-line bg-ink text-center text-xl font-semibold focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          aria-label={`More ${label}`}
          onClick={() => nudge(1)}
          className="size-12 shrink-0 rounded-xl bg-raised text-2xl text-neutral-200 active:bg-neutral-700"
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
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="pb-safe relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-4 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-neutral-400">
            Close
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

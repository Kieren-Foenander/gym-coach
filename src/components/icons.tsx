interface IconProps {
  readonly className?: string
}

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const

export function CheckIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function ArrowUpIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

export function ArrowDownIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  )
}

export function ChevronIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function CloseIcon({ className = "size-5" }: IconProps) {
  return (
    <svg {...stroke} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function FlameIcon({ className = "size-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.6 2c.5 3.200-1 5-2.600 6.700C8.300 10.500 6.500 12.400 6.500 15.300a5.500 5.500 0 0 0 11 0c0-1.800-.7-3.200-1.500-4.300-.4 1.200-1.100 2-2.100 2.400.5-3.600-.300-7.900-1.300-11.400z" />
    </svg>
  )
}

export function TrophyIcon({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.300A5 5 0 0 1 13 14.900V18h3v3H8v-3h3v-3.100A5 5 0 0 1 8.300 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.700zm10 0v2.700A2 2 0 0 0 18 8V7z" />
    </svg>
  )
}

/** The app's mark: a barbell. */
export function BarbellIcon({ className = "size-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <rect x="8" y="11" width="8" height="2" rx="0.5" />
      <rect x="5.500" y="7" width="2.500" height="10" rx="1" />
      <rect x="16" y="7" width="2.500" height="10" rx="1" />
      <rect x="2.500" y="9" width="2" height="6" rx="0.900" />
      <rect x="19.500" y="9" width="2" height="6" rx="0.900" />
    </svg>
  )
}

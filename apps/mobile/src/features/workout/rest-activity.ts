/** Shows the rest countdown outside the app. Only iPhones have somewhere to show it; see rest-activity.ios.ts. */

export interface RestCountdown {
  readonly title: string
  readonly startedAt: number
  readonly endsAt: number
}

export const showRestActivity = (_rest: RestCountdown): void => undefined

export const endRestActivity = (): void => undefined

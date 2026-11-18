/**
 * The AI apps a user can connect to the coach (the MCP server at /mcp), with the steps for each.
 * The server is a plain remote MCP server with OAuth, so any app that takes a custom MCP server works;
 * these are the ones people are likely to have. Menu names change often: keep each step to the words
 * the app shows, and send people to the app's own page with `setupUrl`.
 */

export interface CoachApp {
  readonly id: string
  /** The app's name as its maker writes it. */
  readonly name: string
  /** Where to start setting it up. Null when there is no single page to send people to. */
  readonly setupUrl: string | null
  /** The steps up to and including pasting the address. Signing in and the first message are added by `coachSteps`. */
  readonly steps: ReadonlyArray<string>
  /** A limit worth knowing before starting, such as which plans or devices can add one. */
  readonly note: string | null
}

export const COACH_APPS = [
  {
    id: "claude",
    name: "Claude",
    setupUrl: "https://claude.ai/settings/connectors",
    steps: [
      "In Claude, open Settings, then Connectors, and choose Add custom connector.",
      "Name it Gym and paste the address below.",
    ],
    note: null,
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    setupUrl: "https://chatgpt.com",
    steps: [
      "On chatgpt.com, select the + button, then Add custom MCP server.",
      "Name it Gym, paste the address below as the server URL and choose OAuth.",
    ],
    note: "Set it up on the web; it then works in the phone app too. If you don't see the option, turn on Developer mode in Settings first. In a chat, pick Gym from the + menu.",
  },
  {
    id: "grok",
    name: "Grok",
    setupUrl: "https://grok.com/connectors",
    steps: ["Go to grok.com/connectors, choose New Connector, then Custom.", "Name it Gym and paste the address below."],
    note: null,
  },
  {
    id: "gemini",
    name: "Gemini",
    setupUrl: "https://gemini.google.com",
    steps: [
      "On gemini.google.com, open Settings, then Connected apps, and choose Add a custom app.",
      "Name it Gym and paste the address below.",
    ],
    note: "Custom apps are added on the web and work with personal Google accounts, not work or school ones.",
  },
  {
    id: "le-chat",
    name: "Le Chat",
    setupUrl: "https://chat.mistral.ai",
    steps: [
      "In Le Chat, open the side panel, then Intelligence, then Connectors.",
      "Choose Add Connector, then Custom MCP Connector.",
      "Name it Gym, paste the address below and choose OAuth.",
    ],
    note: null,
  },
  {
    id: "other",
    name: "Other",
    setupUrl: null,
    steps: [
      "Find where your AI app adds a custom connector or MCP server. Some call it an app, a plugin or a tool.",
      "Paste the address below. If it asks how to sign in, choose OAuth.",
    ],
    note: "Any AI app that can use a remote MCP server works. Apps that only run MCP servers on your own computer can't reach this one.",
  },
] as const satisfies ReadonlyArray<CoachApp>

export type CoachAppId = (typeof COACH_APPS)[number]["id"]

export const DEFAULT_COACH_APP: CoachAppId = "claude"

export const coachApp = (id: CoachAppId): CoachApp => COACH_APPS.find((app) => app.id === id) ?? COACH_APPS[0]

/** Every step for one app: its own setup, then signing in and a first message, which are the same everywhere. */
export const coachSteps = (app: CoachApp): ReadonlyArray<string> => [
  ...app.steps,
  "Sign in to Gym when asked, and tap Allow.",
  "In a chat, ask: “Look at my gym log and build me a plan.”",
]

/** The address an AI app connects to, from the server's origin. */
export const coachAddress = (origin: string): string => `${origin.replace(/\/+$/, "")}/mcp`

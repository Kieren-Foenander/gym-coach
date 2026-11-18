/**
 * The AI apps a user can connect to the coach (the MCP server at /mcp), with the steps for each.
 * The server is a plain remote MCP server with OAuth, so any app that takes a custom MCP server works;
 * these are the ones people are likely to have. Menu names change often: keep each step to the words
 * the app shows, and send people to the app's own page with the card's button.
 *
 * None of these apps can add a connector from inside a chat. Claude has a link that opens its
 * "Add custom connector" dialog with the name and address filled in
 * (https://claude.com/docs/connectors/building/directory-vs-custom); the others don't, so their
 * button copies the address and opens the page where it is pasted.
 */

const LIVE_STAGE = "prod"

/**
 * What the connector is called in the AI app, and the MCP server's own name. The live app is Gym; every
 * other copy says which one it is (Gym-dev, Gym-pr-21), so it can sit next to the live one, be asked for
 * by name, and be found again to remove. Letters, digits and hyphens only: some apps refuse other characters.
 */
export const connectorName = (stage: string | null): string => {
  if (!stage || stage === LIVE_STAGE) return "Gym"

  const label = stage.startsWith("dev_") ? "dev" : stage
  const safe = label.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")

  return safe ? `Gym-${safe}` : "Gym-test"
}

/** Whether this copy is a test one, whose connector should be removed when the testing is done. */
export const isTestStage = (stage: string | null): boolean => connectorName(stage) !== "Gym"

export interface CoachApp {
  readonly id: string
  /** The app's name as its maker writes it. */
  readonly name: string
  /** What the card's button does: open a dialog with the address filled in, or copy the address and open a page. */
  readonly setup:
    | { readonly kind: "prefill"; readonly url: (address: string, name: string) => string }
    | { readonly kind: "open"; readonly url: string }
    | null
  /**
   * The steps up to and including pasting the address. NAME stands for the connector's name. Signing in and
   * the first message are added by `coachSteps`.
   */
  readonly steps: ReadonlyArray<string>
  /** A limit worth knowing before starting, or another way to do it. NAME stands for the connector's name. */
  readonly note: string | null
}

export const COACH_APPS = [
  {
    id: "claude",
    name: "Claude",
    setup: {
      kind: "prefill",
      url: (address, name) =>
        `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(name)}&connectorUrl=${encodeURIComponent(address)}`,
    },
    steps: ["Tap Add to Claude. It opens with NAME and its address filled in.", "Check the details and tap Add."],
    note: "Or add it by hand: in Claude, open Settings, then Connectors, choose Add custom connector and paste the address.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    setup: { kind: "open", url: "https://chatgpt.com/plugins" },
    steps: [
      "Tap Copy and open ChatGPT, then select the + button and Add custom MCP server.",
      "Name it NAME, paste the address as the server URL and choose OAuth.",
    ],
    note: "Set it up on the web; it then works in the phone app too. In a chat, pick NAME from the + menu.",
  },
  {
    id: "grok",
    name: "Grok",
    setup: { kind: "open", url: "https://grok.com/connectors" },
    steps: ["Tap Copy and open Grok, then choose New Connector, then Custom.", "Name it NAME and paste the address."],
    note: null,
  },
  {
    id: "gemini",
    name: "Gemini",
    setup: { kind: "open", url: "https://gemini.google.com" },
    steps: [
      "Tap Copy and open Gemini, then open Settings, then Connected apps, and choose Add a custom app.",
      "Name it NAME and paste the address.",
    ],
    note: "Custom apps are added on the web and work with personal Google accounts, not work or school ones.",
  },
  {
    id: "le-chat",
    name: "Le Chat",
    setup: { kind: "open", url: "https://chat.mistral.ai" },
    steps: [
      "Tap Copy and open Le Chat, then open the side panel, then Intelligence, then Connectors.",
      "Choose Add Connector, then Custom MCP Connector.",
      "Name it NAME, paste the address and choose OAuth.",
    ],
    note: null,
  },
  {
    id: "other",
    name: "Other",
    setup: null,
    steps: [
      "Find where your AI app adds a custom connector or MCP server. Some call it an app, a plugin or a tool.",
      "Copy the address below and paste it there. If it asks how to sign in, choose OAuth.",
    ],
    note: "Any AI app that can use a remote MCP server works. Apps that only run MCP servers on your own computer can't reach this one.",
  },
] as const satisfies ReadonlyArray<CoachApp>

export type CoachAppId = (typeof COACH_APPS)[number]["id"]

export const DEFAULT_COACH_APP: CoachAppId = "claude"

export const coachApp = (id: CoachAppId): CoachApp => COACH_APPS.find((app) => app.id === id) ?? COACH_APPS[0]

const withName = (text: string, name: string) => text.replaceAll("NAME", name)

export const coachNote = (app: CoachApp, name: string): string | null => (app.note ? withName(app.note, name) : null)

/** Every step for one app: its own setup, then signing in and a first message, which are the same everywhere. */
export const coachSteps = (app: CoachApp, name: string): ReadonlyArray<string> => [
  ...app.steps.map((step) => withName(step, name)),
  `Sign in to ${name} when asked, and tap Allow.`,
  `In a chat, ask: “Look at my ${name === "Gym" ? "gym log" : `${name} log`} and build me a plan.”`,
]

/** The card's main button: its label, where it goes, and whether it copies the address first. */
export interface CoachAction {
  readonly label: string
  readonly url: string
  readonly copiesAddress: boolean
}

export const coachAction = (app: CoachApp, address: string, name: string): CoachAction | null => {
  if (app.setup === null) return null

  return app.setup.kind === "prefill"
    ? { label: `Add to ${app.name}`, url: app.setup.url(address, name), copiesAddress: false }
    : { label: `Copy and open ${app.name}`, url: app.setup.url, copiesAddress: true }
}

/** The address an AI app connects to, from the server's origin. */
export const coachAddress = (origin: string): string => `${origin.replace(/\/+$/, "")}/mcp`

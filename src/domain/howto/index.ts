import { BACK_AND_CORE } from "./back-core"
import { LOWER } from "./lower"
import type { HowToTable } from "./types"
import { UPPER } from "./upper"
import { WHOLE_BODY } from "./whole-body"

/**
 * How to do every exercise in the library, a few steps each: set up, move, return.
 * Keyed by the name in src/domain/catalog.ts. A test checks the two stay in step.
 */
export const HOW_TO: HowToTable = { ...UPPER, ...BACK_AND_CORE, ...LOWER, ...WHOLE_BODY }

const BY_NAME = new Map(Object.entries(HOW_TO).map(([name, steps]) => [name.toLowerCase(), steps]))

/** The steps for a library exercise, or none for a name the library does not have. */
export const howToFor = (name: string): ReadonlyArray<string> => BY_NAME.get(name.trim().toLowerCase()) ?? []

import { Predicate } from "effect"
import type { CallName } from "~/domain/calls"
import type { CallOutput } from "~/server/calls"

/**
 * The signature of a JSON answer: which fields it has and what kinds of value each holds, without
 * the values themselves. The API contract test keeps the signature of every call's answer, so a
 * change that would break a native build already on someone's phone fails the build.
 */

/** A value as JSON.parse returns it. */
export type Json = null | string | number | boolean | ReadonlyArray<Json> | { readonly [key: string]: Json }

export type Kind = "null" | "string" | "number" | "boolean"

export interface Signature {
  /** The kinds of plain value seen here. */
  readonly kinds?: ReadonlyArray<Kind>
  /** When an object was seen here: the signature of each field. */
  readonly fields?: Readonly<Record<string, Signature>>
  /** When an array was seen here: the signature of its items. An array always seen empty has none. */
  readonly items?: Signature
  /** Whether it was an array. */
  readonly array?: true
}

/** An answer as it crosses the wire: what the native app parses. */
export const asJson = (answer: CallOutput<CallName>): Json => {
  const json: Json = JSON.parse(JSON.stringify(answer ?? null))

  return json
}

const NULL: Signature = { kinds: ["null"] }

const kindOf = (value: string | number | boolean): Kind => {
  if (Predicate.isString(value)) return "string"

  return Predicate.isNumber(value) ? "number" : "boolean"
}

const isList = (value: Json): value is ReadonlyArray<Json> => Array.isArray(value)

export const signatureOf = (value: Json): Signature => {
  if (value === null) return NULL

  if (isList(value)) {
    const items = value.map(signatureOf).reduce<Signature | undefined>((merged, item) => (merged ? mergeSignatures(merged, item) : item), undefined)

    return items ? { array: true, items } : { array: true }
  }

  if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return { kinds: [kindOf(value)] }

  return {
    fields: Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, field]) => [key, signatureOf(field)]),
    ),
  }
}

/** One signature covering two values seen in the same place, such as two items of one array. */
export const mergeSignatures = (a: Signature, b: Signature): Signature => {
  const merged: { -readonly [K in keyof Signature]: Signature[K] } = {}
  const kinds = [...new Set([...(a.kinds ?? []), ...(b.kinds ?? [])])].toSorted()

  if (kinds.length > 0) merged.kinds = kinds

  if (a.fields || b.fields) {
    const keys = [...new Set([...Object.keys(a.fields ?? {}), ...Object.keys(b.fields ?? {})])].toSorted()

    // A field one object has and another lacks may be missing, which a client reads as null.
    merged.fields = Object.fromEntries(keys.map((key) => [key, mergeSignatures(a.fields?.[key] ?? NULL, b.fields?.[key] ?? NULL)]))
  }

  if (a.array || b.array) merged.array = true

  const items = a.items && b.items ? mergeSignatures(a.items, b.items) : (a.items ?? b.items)

  if (items) merged.items = items

  return merged
}

export interface Difference {
  readonly path: string
  readonly change: string
  /** Whether a client built against the old signature could fail on the new one. */
  readonly breaking: boolean
}

/**
 * What changed from the recorded signature to the new one. Removing a field, or a value taking a
 * kind the client has never seen (a number that can now be null, say), breaks old clients. Adding
 * a field, or a value no longer taking a kind it used to, does not.
 */
export const compareSignatures = (before: Signature, after: Signature, path = "$"): ReadonlyArray<Difference> => {
  const differences: Array<Difference> = []
  const beforeKinds = new Set(before.kinds ?? [])
  // A place only ever seen as null was never really recorded, so finding what it holds breaks nothing.
  const onlyNull = beforeKinds.size === 1 && beforeKinds.has("null") && !before.fields && !before.array

  for (const kind of after.kinds ?? []) {
    if (!beforeKinds.has(kind)) differences.push({ path, change: `can now be ${kind}`, breaking: !onlyNull })
  }

  for (const kind of before.kinds ?? []) {
    if (!(after.kinds ?? []).includes(kind)) differences.push({ path, change: `is no longer ${kind}`, breaking: false })
  }

  if (before.fields && !after.fields) differences.push({ path, change: "is no longer an object", breaking: true })

  if (!before.fields && after.fields) differences.push({ path, change: "can now be an object", breaking: !onlyNull })

  if (before.array && !after.array) differences.push({ path, change: "is no longer an array", breaking: true })

  if (!before.array && after.array) differences.push({ path, change: "can now be an array", breaking: !onlyNull })

  if (before.fields && after.fields) {
    for (const [key, field] of Object.entries(before.fields)) {
      const next = after.fields[key]

      if (next) differences.push(...compareSignatures(field, next, `${path}.${key}`))
      else differences.push({ path: `${path}.${key}`, change: "was removed", breaking: true })
    }

    for (const key of Object.keys(after.fields)) {
      if (!(key in before.fields)) differences.push({ path: `${path}.${key}`, change: "was added", breaking: false })
    }
  }

  if (before.items && after.items) differences.push(...compareSignatures(before.items, after.items, `${path}[]`))

  if (!before.items && after.items && before.array) {
    differences.push({ path: `${path}[]`, change: "now has items to record", breaking: false })
  }

  return differences
}

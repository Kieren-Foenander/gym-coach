import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEMO_VIEWS, demoFile, RENDERED_SLUGS, demoFor } from "~/domain/demos"
import { isExerciseMedia, serveExerciseMedia, type MediaBucket, type MediaObject, type MediaObjectBody } from "~/server/media"

const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i))

// Shaped as R2 returns it: every field present, the ones that do not apply undefined.
type Range = { offset: number | undefined; length: number | undefined; suffix: number | undefined }

const metadata = (range?: Range): MediaObject => ({
  size: BYTES.length,
  httpEtag: '"abc"',
  range,
  writeHttpMetadata: (headers: Headers) => headers.set("content-type", "video/mp4"),
})

/** An object as R2 returns it, cut to the range asked for. */
const withBody = (range?: Range): MediaObjectBody => {
  const span = !range
    ? BYTES
    : range.suffix !== undefined
      ? BYTES.slice(-range.suffix)
      : BYTES.slice(range.offset ?? 0, range.length === undefined ? undefined : (range.offset ?? 0) + range.length)

  return { ...metadata(range), body: new Blob([span]).stream() }
}

/** A stand-in bucket holding one video, which reads ranges and If-None-Match the way R2 does. */
const bucket = (keys = ["exercises/squat.mp4"]): MediaBucket & { asked: string[] } => {
  const asked: string[] = []

  return {
    asked,
    head: async (key) => (keys.includes(key) ? metadata() : null),
    get: async (key, options) => {
      asked.push(key)

      if (!keys.includes(key)) return null

      if (options.onlyIf.get("if-none-match") === '"abc"') return metadata()

      const header = options.range.get("range")

      if (!header) return withBody()

      const [, from = "", to = ""] = /bytes=(\d*)-(\d*)/.exec(header) ?? []

      if (Number(from) >= BYTES.length) throw new Error("InvalidRange")

      if (from === "") return withBody({ offset: undefined, length: undefined, suffix: Number(to) })

      return withBody({ offset: Number(from), length: to === "" ? undefined : Number(to) - Number(from) + 1, suffix: undefined })
    },
  }
}

const request = (path: string, init?: RequestInit) => new Request(`https://gym.test${path}`, init)

describe("exercise media", () => {
  it("is never committed or served from the static assets", () => {
    const media = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? media(join(dir, entry.name)) : /\.(mp4|webm|mov|webp)$/.test(entry.name) ? [join(dir, entry.name)] : [],
      )

    expect(media("public")).toEqual([])
  })

  it("claims every demonstration file and none of the pages", () => {
    for (const slug of RENDERED_SLUGS) {
      const demo = demoFor(slug)

      if (!demo) throw new Error(`No demo for ${slug}`)

      for (const view of demo.views) {
        expect(isExerciseMedia(`${demoFile(demo, view)}.mp4`), slug).toBe(true)
        expect(isExerciseMedia(`${demoFile(demo, view)}.webp`), slug).toBe(true)
      }
    }

    expect(Object.keys(DEMO_VIEWS)).toContain("back")

    for (const path of ["/exercises", "/exercises/squat", "/exercises/../secret.mp4", "/exercises/a/b.mp4", "/exercises/squat.mp4.html"]) {
      expect(isExerciseMedia(path), path).toBe(false)
    }
  })

  it("streams a whole file from the bucket with its type and cache headers", async () => {
    const media = bucket()
    const response = await serveExerciseMedia(request("/exercises/squat.mp4"), media)

    expect(response.status).toBe(200)
    expect(media.asked).toEqual(["exercises/squat.mp4"])
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("content-length")).toBe("100")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("etag")).toBe('"abc"')
    expect(response.headers.get("cache-control")).toContain("max-age=")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it("answers the byte ranges a video player asks for", async () => {
    const middle = await serveExerciseMedia(request("/exercises/squat.mp4", { headers: { range: "bytes=10-19" } }), bucket())
    expect(middle.status).toBe(206)
    expect(middle.headers.get("content-range")).toBe("bytes 10-19/100")
    expect(middle.headers.get("content-length")).toBe("10")
    expect(new Uint8Array(await middle.arrayBuffer())).toEqual(BYTES.slice(10, 20))

    const rest = await serveExerciseMedia(request("/exercises/squat.mp4", { headers: { range: "bytes=90-" } }), bucket())
    expect(rest.headers.get("content-range")).toBe("bytes 90-99/100")

    const tail = await serveExerciseMedia(request("/exercises/squat.mp4", { headers: { range: "bytes=-5" } }), bucket())
    expect(tail.headers.get("content-range")).toBe("bytes 95-99/100")

    const past = await serveExerciseMedia(request("/exercises/squat.mp4", { headers: { range: "bytes=500-" } }), bucket())
    expect(past.status).toBe(416)
    expect(past.headers.get("content-range")).toBe("bytes */100")
  })

  it("says not modified when the browser's copy is current", async () => {
    const response = await serveExerciseMedia(request("/exercises/squat.mp4", { headers: { "if-none-match": '"abc"' } }), bucket())
    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  it("answers HEAD without a body, and 404 for a file the bucket does not have", async () => {
    const head = await serveExerciseMedia(request("/exercises/squat.mp4", { method: "HEAD" }), bucket())
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe("100")
    expect(head.body).toBeNull()

    expect((await serveExerciseMedia(request("/exercises/lunge.mp4"), bucket())).status).toBe(404)
    expect((await serveExerciseMedia(request("/exercises/squat.mp4", { method: "POST" }), bucket())).status).toBe(405)
  })
})

/**
 * Exercise demonstration videos and posters. They live in an R2 bucket bound to the Worker,
 * never in the repo or the static assets, and are streamed from here at /exercises/<file>.
 * tools/mannequin/publish.sh uploads them under the same key, "exercises/<file>".
 */

/** The R2 bucket every stage reads, prod and previews alike. alchemy.run.ts binds it as EXERCISE_MEDIA. */
export const MEDIA_BUCKET = "gym-exercise-media"

// A slug (src/domain/catalog.ts), an optional view suffix such as "-rear", and the file type.
const MEDIA_PATH = /^\/exercises\/[a-z0-9]+(?:-[a-z0-9]+)*\.(mp4|webp)$/

const CONTENT_TYPES = { mp4: "video/mp4", webp: "image/webp" } as const

// A re-render overwrites the same key, so browsers recheck within the hour and use the etag to do it cheaply.
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

/** The parts of an R2 object the handler reads. R2Object and R2ObjectBody have them all. */
export interface MediaObject {
  readonly size: number
  readonly httpEtag: string
  readonly range?: R2Range
  writeHttpMetadata(headers: Headers): void
}

export interface MediaObjectBody extends MediaObject {
  readonly body: ReadableStream
}

/** What the handler needs from the bucket. An R2Bucket binding is one; tests pass a stand-in. */
export interface MediaBucket {
  head(key: string): Promise<MediaObject | null>
  get(key: string, options: { range: Headers; onlyIf: Headers }): Promise<MediaObjectBody | MediaObject | null>
}

/** Whether a path is a demonstration file rather than a page, such as /exercises/squat (the library page). */
export const isExerciseMedia = (pathname: string): boolean => MEDIA_PATH.test(pathname)

const headersFor = (object: MediaObject, extension: keyof typeof CONTENT_TYPES) => {
  const headers = new Headers()
  object.writeHttpMetadata(headers)

  if (!headers.has("content-type")) headers.set("content-type", CONTENT_TYPES[extension])
  headers.set("etag", object.httpEtag)
  headers.set("cache-control", CACHE_CONTROL)
  // Safari will only play a video from a server that answers byte ranges.
  headers.set("accept-ranges", "bytes")

  return headers
}

/** The first and last byte a ranged read returned, for the Content-Range header. */
const byteSpan = (range: R2Range, size: number) => {
  if ("suffix" in range) return { start: Math.max(0, size - range.suffix), end: size - 1 }
  const start = range.offset ?? 0

  return { start, end: range.length === undefined ? size - 1 : start + range.length - 1 }
}

/** Serves one file from the bucket, answering HEAD, conditional and byte-range requests. */
export async function serveExerciseMedia(request: Request, bucket: MediaBucket): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
  }

  const { pathname } = new URL(request.url)
  const match = MEDIA_PATH.exec(pathname)

  if (!match) return new Response("Not found", { status: 404 })

  const key = pathname.slice(1)
  const extension = match[1] === "webp" ? "webp" : "mp4"

  if (request.method === "HEAD") {
    const object = await bucket.head(key)

    if (!object) return new Response(null, { status: 404 })
    const headers = headersFor(object, extension)
    headers.set("content-length", String(object.size))

    return new Response(null, { headers })
  }

  let object: MediaObject | MediaObjectBody | null

  try {
    object = await bucket.get(key, { range: request.headers, onlyIf: request.headers })
  } catch {
    // R2 rejects a range that starts past the end of the object.
    const head = await bucket.head(key)

    if (!head) return new Response("Not found", { status: 404 })

    return new Response(null, { status: 416, headers: { "content-range": `bytes */${head.size}` } })
  }

  if (!object) return new Response("Not found", { status: 404 })

  const headers = headersFor(object, extension)

  // R2 leaves out the body when a precondition (If-None-Match, If-Modified-Since...) says the copy is current.
  if (!("body" in object)) {
    const conditional = request.headers.has("if-none-match") || request.headers.has("if-modified-since")

    return new Response(null, { status: conditional ? 304 : 412, headers })
  }

  if (request.headers.has("range") && object.range) {
    const { start, end } = byteSpan(object.range, object.size)
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`)
    headers.set("content-length", String(end - start + 1))

    return new Response(object.body, { status: 206, headers })
  }

  headers.set("content-length", String(object.size))

  return new Response(object.body, { headers })
}

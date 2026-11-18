/**
 * Tells the URL's own echoes of what a text field wrote apart from changes that came from elsewhere.
 *
 * A field that mirrors its text into the URL can't take its value from the URL: the router commits the new
 * address a moment later, so a fast typist's next letter lands on stale text and is lost. The field keeps the
 * text itself and writes it to the URL; when the URL changes, this says whether the field should take the new
 * value (Back, a link, the tab bar) or ignore it because it only repeats something the field already wrote.
 */
export function createUrlEcho() {
  const pending = new Set<string>()
  let latest: string | null = null

  return {
    /** Records a value the field is about to write to the URL. */
    wrote(value: string) {
      pending.add(value)
      latest = value
    },
    /** True when the URL's new value came from somewhere other than the field. */
    isOutside(value: string) {
      if (!pending.has(value)) return true

      // Once the URL has caught up with the field, every earlier write has been passed or overtaken.
      if (value === latest) {
        pending.clear()
        latest = null
      }

      return false
    },
  }
}

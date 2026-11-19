/**
 * The copying array methods from ES2023, which the shared code in src/domain uses and the web runs natively.
 * The Hermes engine in this React Native has none of them, so without this the first call crashes the screen
 * (the Today tab did, in RecoveryCard). index.ts loads this before anything else.
 */

const add = (name: "toSorted" | "toReversed" | "toSpliced" | "with", value: Function) => {
  if (name in Array.prototype) return

  Object.defineProperty(Array.prototype, name, { value, writable: true, configurable: true, enumerable: false })
}

export function installArrayPolyfills() {
  add("toSorted", function <T>(this: Array<T>, compare?: (a: T, b: T) => number) {
    return this.slice().sort(compare)
  })

  add("toReversed", function <T>(this: Array<T>) {
    return this.slice().reverse()
  })

  add("toSpliced", function <T>(this: Array<T>, start: number, deleteCount?: number, ...items: Array<T>) {
    const copy = this.slice()

    if (deleteCount === undefined) copy.splice(start)
    else copy.splice(start, deleteCount, ...items)

    return copy
  })

  add("with", function <T>(this: Array<T>, index: number, value: T) {
    const at = index < 0 ? this.length + index : index

    if (at < 0 || at >= this.length) throw new RangeError("Invalid index")

    const copy = this.slice()
    copy[at] = value

    return copy
  })
}

installArrayPolyfills()

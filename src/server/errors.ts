import { Data } from "effect"

export class NotFound extends Data.TaggedError("NotFound")<{ readonly what: string }> {
  override get message() {
    return `${this.what} not found`
  }
}

export class Invalid extends Data.TaggedError("Invalid")<{ readonly reason: string }> {
  override get message() {
    return this.reason
  }
}

export class Unauthorized extends Data.TaggedError("Unauthorized")<{}> {
  override get message() {
    return "Not signed in"
  }
}

export type DomainError = NotFound | Invalid | Unauthorized

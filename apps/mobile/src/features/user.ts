import { createContext, use } from "react"
import type { User } from "~/server/repo"

/** The signed-in account. Only the screens behind sign-in are rendered inside it. */
export const UserContext = createContext<User | null>(null)

export const useUser = (): User => {
  const user = use(UserContext)

  if (user === null) throw new Error("This screen needs someone to be signed in.")

  return user
}

import * as SecureStore from "expo-secure-store"

/** The phone's keychain. The session token lives here and nowhere else. */
export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
}

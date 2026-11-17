import Storage from "expo-sqlite/kv-store"

/**
 * Small values kept on the phone between launches: the cached screens, sets waiting to be
 * sent, and preferences. Nothing secret goes here; the session token is in secure-storage.ts.
 */
export const storage = {
  get: (key: string): string | null => Storage.getItemSync(key),
  set: (key: string, value: string): void => Storage.setItemSync(key, value),
  remove: (key: string): void => {
    Storage.removeItemSync(key)
  },
  getAsync: (key: string): Promise<string | null> => Storage.getItem(key),
  setAsync: (key: string, value: string): Promise<void> => Storage.setItem(key, value),
  removeAsync: async (key: string): Promise<void> => {
    await Storage.removeItem(key)
  },
}

/** The browser stand-in for storage.ts. The app only runs in a browser while it is being developed. */
export const storage = {
  get: (key: string): string | null => window.localStorage.getItem(key),
  set: (key: string, value: string): void => window.localStorage.setItem(key, value),
  remove: (key: string): void => window.localStorage.removeItem(key),
  getAsync: (key: string): Promise<string | null> => Promise.resolve(window.localStorage.getItem(key)),
  setAsync: (key: string, value: string): Promise<void> => Promise.resolve(window.localStorage.setItem(key, value)),
  removeAsync: (key: string): Promise<void> => Promise.resolve(window.localStorage.removeItem(key)),
}

/** The browser stand-in for secure-storage.ts. The app only runs in a browser while it is being developed. */
export const secureStorage = {
  get: (key: string): Promise<string | null> => Promise.resolve(window.sessionStorage.getItem(key)),
  set: (key: string, value: string): Promise<void> => Promise.resolve(window.sessionStorage.setItem(key, value)),
  remove: (key: string): Promise<void> => Promise.resolve(window.sessionStorage.removeItem(key)),
}

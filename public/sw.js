/*
 * The service worker. It only shows mini workout nudges (src/server/minis.ts sends them, encrypted
 * for this browser) and opens the page a tapped nudge names. It does not touch any other request,
 * so the app loads exactly as it does without it.
 */

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let message = {}

  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { title: "Gym", body: event.data ? event.data.text() : "" }
  }

  event.waitUntil(
    self.registration.showNotification(message.title || "Gym", {
      body: message.body || "",
      tag: message.tag || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: message.url || "/minis" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const target = new URL(event.notification.data?.url || "/minis", self.location.origin)
  // Only ever open this app's own pages.
  const url = target.origin === self.location.origin ? target.href : new URL("/minis", self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)

      if (open) {
        await open.focus()

        return open.navigate(url)
      }

      return self.clients.openWindow(url)
    }),
  )
})

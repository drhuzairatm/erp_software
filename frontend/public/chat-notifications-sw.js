// Only for chat notifications on browsers that cannot create one from a page (Android). It caches nothing and never touches
// requests. It opens only an internal conversation address.
self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data && event.notification.data.url
  event.notification.close()
  if (typeof url !== 'string' || !/^\/chat\?c=[0-9a-f-]{36}$/.test(url)) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
    const client = open.find((c) => 'focus' in c)
    if (!client) return self.clients.openWindow(url)
    return client.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : undefined))
  }))
})

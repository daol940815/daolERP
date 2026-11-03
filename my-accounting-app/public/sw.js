/* daolERP 서비스 워커 — PC 알림(Web Push) 전용 (업무요청 트랙 ⑦, 2026-11-03)
   캐시·오프라인 기능은 없다. 푸시가 오면 OS 알림을 띄우고, 누르면 해당 화면을 연다(열려 있으면 그 탭으로). */

self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()) })

self.addEventListener('push', function (event) {
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { title: 'daolERP', body: event.data ? event.data.text() : '' } }
  var title = data.title || 'daolERP 알림'
  var options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/me/requests' },
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var url = (event.notification.data && event.notification.data.url) || '/me/requests'
  var target = new URL(url, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i]
        if (c.url && new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then(function (w) { return w && 'navigate' in w ? w.navigate(target) : w })
        }
      }
      return self.clients.openWindow(target)
    })
  )
})

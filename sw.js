// キャッシュ優先 → 裏で更新。GASの初回応答が遅くても画面が即出る。
// ＋ Web Push受信（本文はGASの notifyfeed から取得してロック画面に表示）
const V = 'zemi-v18';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k =>
    Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // APIとフォントはキャッシュ制御しない（常にネットワーク）
  if (url.includes('script.google.com') || url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return;
  // 同一オリジンのみキャッシュ対象
  if (new URL(url).origin !== self.location.origin) return;
  const path = new URL(url).pathname;
  const isHTML = e.request.mode === 'navigate' || path.endsWith('/') || path.endsWith('/index.html');
  if (isHTML) {
    // HTMLはネットワーク優先＝アプリを直したら次に開いた時に自動で最新になる（オフライン時はキャッシュ）。
    // 予定・やること等のデータは localStorage / スプレッドシート側なのでこの更新では消えない。
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(V).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(h => h || caches.match('./index.html')))
    );
    return;
  }
  // アイコン等の静的ファイルはキャッシュ優先（速い）
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(V).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

/* ---------------- Web Push ---------------- */
// ページ側が購読時に保存した接続情報（url/me/key）を IndexedDB から読む
function idbGet(key) {
  return new Promise(resolve => {
    const rq = indexedDB.open('zemi-push', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onerror = () => resolve(null);
    rq.onsuccess = () => {
      const tx = rq.result.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get(key);
      g.onsuccess = () => resolve(g.result || null);
      g.onerror = () => resolve(null);
    };
  });
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = '水野ゼミ カレンダー', body = '今日の予定・締切を確認しましょう';
    try {
      const c = await idbGet('pushcfg');
      if (c && c.url) {
        const r = await fetch(c.url + '?action=notifyfeed&me=' + encodeURIComponent(c.me || '') +
          (c.key ? '&key=' + encodeURIComponent(c.key) : ''), { cache: 'no-store' });
        const j = await r.json();
        if (j && j.body) { title = j.title || title; body = j.body; }
      }
    } catch (_) { /* 取得失敗時は汎用文面で表示 */ }
    await self.registration.showNotification(title, {
      body, icon: './icon-192.png', badge: './icon-192.png', tag: 'zemi-notify'
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return clients.openWindow('./');
  }));
});

// 購読が失効・更新されたら再購読して登録し直す
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const c = await idbGet('pushcfg');
      if (!c || !c.url || !c.vapidPub) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(atob(c.vapidPub.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))
      });
      await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'subscribe', name: c.me || '', sub: sub.toJSON(), key: c.key || '' }) });
    } catch (_) {}
  })());
});

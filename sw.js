// キャッシュ優先 → 裏で更新。GASの初回応答が遅くても画面が即出る。
// ＋ Web Push受信（本文はGASの notifyfeed から取得してロック画面に表示）
const V = 'zemi-calendar-v57';
const CORE = ['./', './index.html', './ai-core.js?v=57', './manifest.json?v=57', './privacy.html', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k =>
    Promise.all(k.filter(x => (x.startsWith('zemi-calendar-v') || x === 'zemi-v54') && x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // APIとフォントはキャッシュ制御しない（常にネットワーク）
  if (url.includes('script.google.com')) return;
  // 同一オリジンのみキャッシュ対象
  if (new URL(url).origin !== self.location.origin) return;
  const path = new URL(url).pathname;
  const isHTML = e.request.mode === 'navigate' || path.endsWith('/') || path.endsWith('/index.html');
  if (isHTML) {
    // HTMLはネットワーク優先＝アプリを直したら次に開いた時に自動で最新になる（オフライン時はキャッシュ）。
    // 予定・やること等のデータは localStorage / スプレッドシート側なのでこの更新では消えない。
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const copy = res.clone();
        caches.open(V).then(c => c.put('./index.html', copy));
        return res;
      }).catch(async () => (await caches.match('./index.html', { ignoreSearch: true })) || new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ゼミカレンダー</title><body style="font-family:-apple-system,sans-serif;padding:32px;background:#f1efe9;color:#232a2a"><h2>ゼミカレンダー</h2><p>通信を確認して、もう一度開いてください。端末の予定や設定は消えていません。</p><button onclick="location.reload()" style="padding:12px 18px">再読み込み</button></body>',
        { headers: { 'Content-Type': 'text/html;charset=utf-8' }, status: 503 }
      ))
    );
    return;
  }
  // JS等は検索文字列を無視して同じ版のキャッシュへフォールバックする。
  // 取得失敗時にindex.htmlを返すと「HTMLをJavaScriptとして実行」して起動不能になるため、絶対に返さない。
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const copy = res.clone();
      caches.open(V).then(c => c.put(e.request, copy));
      return res;
    }))
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

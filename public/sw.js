/* 自愈式空 Service Worker
 *
 * 本项目并不真正依赖 Service Worker。此文件仅用于消除「历史版本遗留的 SW 注册」
 * 在浏览器中持续拉取 /sw.js 造成的 404 噪音：浏览器下次请求本文件并激活后，
 * 会立即 self-registration.unregister()，随后不再发起 /sw.js 请求。
 *
 * 注意：不要在本文件里添加 fetch 缓存逻辑，否则会干扰正常的网络请求。
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // 激活即注销自身，移除遗留注册，停止对 /sw.js 的轮询。
  event.waitUntil(self.registration.unregister());
});

// 透传所有请求，不做任何拦截/缓存。
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

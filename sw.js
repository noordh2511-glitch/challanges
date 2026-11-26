/**
 * Service Worker لتطبيق «سين جيم» (Real PWA + Offline App Shell)
 * - يخزّن كامل هيكل التطبيق (App Shell) للعمل 100% دون إنترنت
 * - NetworkFirst لبيانات Google Sheets مع استعادة فورية من الكاش عند انقطاع الشبكة
 * - CacheFirst لخطوط Google Fonts (Cairo) والملفات الثابتة والصور المحلية
 * - navigateFallback يحافظ على معاملات الاستعلام مثل ?mode=display في وضع الأوفلاين
 */
const CACHE_VERSION = "seen-jeem-v4.13.0";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const SHEETS_CACHE = `${CACHE_VERSION}-sheets`;
const FONTS_CACHE = `${CACHE_VERSION}-fonts`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sheets-config.js",
  "./firebaseConfig.js",
  "./src/css/styles.css",
  "./src/data/questions.js",
  "./src/data/extra-questions.js",
  "./src/utils/historyStore.js",
  "./src/utils/sheetSanitizer.js",
  "./src/utils/matchStore.js",
  "./src/utils/finalRound.js",
  "./src/utils/imagePreloader.js",
  "./src/utils/liveSync.js",
  "./src/utils/wakeLock.js",
  "./src/utils/flaggedQuestionsStore.js",
  "./src/utils/matchArchiveStore.js",
  "./src/utils/blitzMode.js",
  "./src/utils/charadesMode.js",
  "./src/utils/qrGenerator.js",
  "./src/utils/realtimeSync.js",
  "./src/utils/baraSalfaBank.js",
  "./src/utils/baraSalfaSync.js",
  "./src/utils/backupManager.js",
  "./src/utils/resultCardGenerator.js",
  "./src/utils/audioChallengePlayer.js",
  "./src/utils/customPacksStore.js",
  "./src/utils/pwaManager.js",
  "./src/js/audio.js",
  "./src/js/confetti.js",
  "./src/js/displayView.js",
  "./src/js/remoteHostView.js",
  "./src/js/playerView.js",
  "./src/js/baraSalfaMode.js",
  "./src/js/baraSalfaPlayerView.js",
  "./src/js/tournamentMode.js",
  "./src/js/customPackBuilder.js",
  "./src/js/app.js",
  "./src/assets/icons/icon.svg",
  "./src/assets/icons/icon-192.png",
  "./src/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(async (cache) => {
      // استخدام allSettled لضمان نجاح التثبيت حتى لو تعذّر ملف ثانوي
      await Promise.allSettled(
        APP_SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  const activeCaches = new Set([APP_SHELL_CACHE, SHEETS_CACHE, FONTS_CACHE, RUNTIME_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (!activeCaches.has(key)) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isGoogleSheetsRequest(url) {
  return (
    url.hostname.includes("docs.google.com") ||
    url.hostname.includes("googleusercontent.com") ||
    url.hostname.includes("sheets.googleapis.com")
  );
}

function isGoogleFontsRequest(url) {
  return (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  );
}

async function networkFirst(request, cacheName, timeoutMs = 6000) {
  const cache = await caches.open(cacheName);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const fetchOpts = controller ? { signal: controller.signal } : undefined;
    const response = await fetch(request, fetchOpts);
    if (timerId) clearTimeout(timerId);
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_err) {
    if (timerId) clearTimeout(timerId);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise);
}

function isFirebaseRealtimeOrAuthRequest(url) {
  return (
    url.hostname.endsWith(".firebaseio.com") ||
    url.hostname.endsWith(".firebasedatabase.app") ||
    url.hostname === "identitytoolkit.googleapis.com" ||
    url.hostname === "securetoken.googleapis.com" ||
    url.hostname === "firebase.googleapis.com" ||
    url.hostname === "firebaseinstallations.googleapis.com" ||
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))
  );
}

function isAudioOrRangeRequest(request, url) {
  if (request.headers && request.headers.has("range")) return true;
  if (request.destination === "audio" || request.destination === "video") return true;
  return /\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 0) تمرير مباشر لطلبات Firebase RTDB وAuth وطلبات الصوت / Range (لضمان عمل 206 Partial Content دون تعطل)
  if (isFirebaseRealtimeOrAuthRequest(url) || isAudioOrRangeRequest(request, url)) {
    return;
  }

  // 1) تنقلات الصفحات (مع الحفاظ التام على معاملات الاستعلام مثل ?mode=display و?mode=remote و?mode=player في وضع الأوفلاين)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResp = await fetch(request);
          if (networkResp && networkResp.ok) {
            const shellCache = await caches.open(APP_SHELL_CACHE);
            shellCache.put("./index.html", networkResp.clone()).catch(() => {});
          }
          return networkResp;
        } catch (_offlineErr) {
          const shellCache = await caches.open(APP_SHELL_CACHE);
          const fallback =
            (await shellCache.match("./index.html")) ||
            (await shellCache.match("./")) ||
            (await caches.match("./index.html"));
          if (fallback) return fallback;
          return new Response(
            "<!DOCTYPE html><html lang='ar' dir='rtl'><body style='background:#060b19;color:#fff;font-family:sans-serif;text-align:center;padding:3rem'><h1>سين جيم</h1><p>أنت غير متصل بالإنترنت حالياً.</p></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  // 2) طلبات Google Sheets: NetworkFirst مع fallback فوري للكاش
  if (isGoogleSheetsRequest(url)) {
    event.respondWith(networkFirst(request, SHEETS_CACHE, 6500));
    return;
  }

  // 3) خطوط Google Fonts (Cairo): CacheFirst
  if (isGoogleFontsRequest(url)) {
    event.respondWith(cacheFirst(request, FONTS_CACHE));
    return;
  }

  // 4) ملفات نفس الأصل (App Shell + صور محلية): CacheFirst / StaleWhileRevalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const shellCache = await caches.open(APP_SHELL_CACHE);
        const exactCached = await shellCache.match(request, { ignoreSearch: true });
        if (exactCached) {
          // تحديث صامت بالخلفية عند الاتصال
          fetch(request)
            .then((fresh) => {
              if (fresh && fresh.ok) {
                shellCache.put(request, fresh.clone()).catch(() => {});
              }
            })
            .catch(() => {});
          return exactCached;
        }
        return staleWhileRevalidate(request, RUNTIME_CACHE);
      })()
    );
  }
});

/**
 * Service Worker لتطبيق «سين جيم» (Real PWA + Offline App Shell)
 * - يخزّن كامل هيكل التطبيق (App Shell) للعمل 100% دون إنترنت
 * - NetworkFirst لبيانات Google Sheets مع استعادة فورية من الكاش عند انقطاع الشبكة
 * - CacheFirst لخطوط Google Fonts (Cairo) والملفات الثابتة والصور المحلية
 * - navigateFallback يحافظ على معاملات الاستعلام مثل ?mode=display في وضع الأوفلاين
 */
const CACHE_VERSION = "seen-jeem-v4.23.0";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const SHEETS_CACHE = `${CACHE_VERSION}-sheets`;
const FONTS_CACHE = `${CACHE_VERSION}-fonts`;
const IMAGES_CACHE = `${CACHE_VERSION}-images`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const MAX_CACHED_IMAGES = 250;
const IMAGES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 يوماً

const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sheets-config.js",
  "./firebaseConfig.js",
  "./adminConfig.js",
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
  "./src/utils/mafiaSync.js",
  "./src/utils/quickGamesSync.js",
  "./src/utils/quizRaceSync.js",
  "./src/utils/categoryThemes.js",
  "./src/utils/categoryBrowser.js",
  "./src/utils/backupManager.js",
  "./src/utils/resultCardGenerator.js",
  "./src/utils/audioChallengePlayer.js",
  "./src/utils/customPacksStore.js",
  "./src/utils/cloudSyncManager.js",
  "./src/utils/playerProfileManager.js",
  "./src/utils/sheetReportSync.js",
  "./src/utils/pwaManager.js",
  "./src/js/audio.js",
  "./src/js/confetti.js",
  "./src/js/displayView.js",
  "./src/js/remoteHostView.js",
  "./src/js/playerView.js",
  "./src/js/baraSalfaMode.js",
  "./src/js/baraSalfaPlayerView.js",
  "./src/js/mafiaMode.js",
  "./src/js/mafiaPlayerView.js",
  "./src/js/quickGamePlayerView.js",
  "./src/js/quizRaceMode.js",
  "./src/js/quizRacePlayerView.js",
  "./src/js/audioChallengeMode.js",
  "./src/js/tournamentMode.js",
  "./src/js/customPackBuilder.js",
  "./src/js/app.js",
  "./apple-touch-icon.png",
  "./src/assets/icons/icon.svg",
  "./src/assets/icons/icon-192.png",
  "./src/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then(async (cache) => {
        // استخدام allSettled لضمان نجاح التثبيت حتى لو تعذّر ملف ثانوي (دون precache لصور /images/ الـ 220 لسرعة التثبيت)
        await Promise.allSettled(
          APP_SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const activeCaches = new Set([APP_SHELL_CACHE, SHEETS_CACHE, FONTS_CACHE, IMAGES_CACHE, RUNTIME_CACHE]);
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

async function trimCacheEntries(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_err) {}
}

async function cacheImageWithTimestamp(cache, request, response) {
  try {
    if (!response || (!response.ok && response.type !== "opaque")) return;
    if (response.type === "opaque") {
      await cache.put(request, response.clone());
    } else {
      const headers = new Headers(response.headers);
      headers.set("x-sw-cached-at", String(Date.now()));
      const body = await response.clone().arrayBuffer();
      const stamped = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
      await cache.put(request, stamped);
    }
    await trimCacheEntries(cache, MAX_CACHED_IMAGES);
  } catch (_err) {}
}

async function cacheFirstImages(request, cacheName, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    const cachedAt = Number(cached.headers.get("x-sw-cached-at")) || 0;
    const isExpired = cachedAt > 0 && Date.now() - cachedAt > maxAgeMs;
    if (!isExpired) {
      return cached;
    }
  }

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
      cacheImageWithTimestamp(cache, request, response);
    }
    return response;
  } catch (_err) {
    if (cached) return cached;
    throw _err;
  }
}

function isLocalImagesRequest(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/images/") || url.pathname.includes("/images/"));
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
    url.hostname === "accounts.google.com" ||
    url.hostname === "script.google.com" ||
    url.hostname === "script.googleusercontent.com" ||
    url.pathname.startsWith("/__/auth/") ||
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

  // 1) تنقلات الصفحات (مع الحفاظ التام على معاملات الاستعلام مثل ?mode=display و?mode=remote و?mode=player و?mode=bara-player و?mode=mafia-player في وضع الأوفلاين)
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

  // 4) صور الفئات والمجموعات (/images/): CacheFirst (بحد أقصى 250 صورة وصلاحية 30 يوماً)
  if (isLocalImagesRequest(url)) {
    event.respondWith(cacheFirstImages(request, IMAGES_CACHE, IMAGES_MAX_AGE_MS));
    return;
  }

  // 5) ملفات نفس الأصل (App Shell): CacheFirst مع تحديث بالخلفية / StaleWhileRevalidate
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

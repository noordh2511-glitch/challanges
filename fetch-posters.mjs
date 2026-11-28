/**
 * سكربت جلب بوسترات فئات «أفلام ومسلسلات» (43 فئة) من TMDB API
 * وتحويلها وضغطها بصيغة WebP (عرض 600px، جودة 82) داخل public/images/categories/
 *
 * الاستخدام:
 * 1) استبدل YOUR_TMDB_API_KEY بمفتاح TMDB API الخاص بك (أو مرّره عبر TMDB_API_KEY)
 * 2) شغّل الأمر: node fetch-posters.mjs
 *    (أضف --force لإعادة تحميل الصور الموجودة مسبقاً)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const API_KEY = "YOUR_TMDB_API_KEY";
const EFFECTIVE_API_KEY = process.env.TMDB_API_KEY || API_KEY;

const DELAY_MS = 250;
const TARGET_WIDTH = 600;
const WEBP_QUALITY = 82;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, "public", "images", "categories");

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";

/**
 * قائمة الـ 43 فئة (sh20-* الفن المصري | sh21-* الفن السوري | sh22-* مسلسلات وأفلام أجنبية)
 */
const CATEGORIES = [
  // ================= الفن المصري (14 فئة) =================
  { id: "sh20-eg-ostora", group: "egyptian-art", queries: [{ type: "tv", q: "الأسطورة", lang: "ar-EG" }, { type: "tv", q: "Al Ostoura", lang: "en-US" }] },
  { id: "sh20-eg-gaafar", group: "egyptian-art", queries: [{ type: "tv", q: "جعفر العمدة", lang: "ar-EG" }, { type: "tv", q: "Gaafar El Omda", lang: "en-US" }] },
  { id: "sh20-eg-kabeer", group: "egyptian-art", queries: [{ type: "tv", q: "الكبير أوي", lang: "ar-EG" }, { type: "tv", q: "El Kabeer Awy", lang: "en-US" }] },
  { id: "sh20-eg-classics", group: "egyptian-art", queries: [{ type: "tv", q: "لن أعيش في جلباب أبي", lang: "ar-EG" }, { type: "tv", q: "رأفت الهجان", lang: "ar-EG" }, { type: "tv", q: "ليالي الحلمية", lang: "ar-EG" }] },
  { id: "sh20-eg-adel", group: "egyptian-art", queries: [{ type: "person", q: "Adel Emam", lang: "en-US" }, { type: "movie", q: "مرجان أحمد مرجان", lang: "ar-EG" }] },
  { id: "sh20-eg-helmy", group: "egyptian-art", queries: [{ type: "movie", q: "عسل أسود", lang: "ar-EG" }, { type: "person", q: "Ahmed Helmy", lang: "en-US" }] },
  { id: "sh20-eg-karim", group: "egyptian-art", queries: [{ type: "movie", q: "الفيل الأزرق", lang: "ar-EG" }, { type: "movie", q: "The Blue Elephant", lang: "en-US" }, { type: "person", q: "Karim Abdel Aziz", lang: "en-US" }] },
  { id: "sh20-eg-ezz", group: "egyptian-art", queries: [{ type: "movie", q: "ولاد رزق", lang: "ar-EG" }, { type: "movie", q: "Welad Rizk", lang: "en-US" }, { type: "person", q: "Ahmed Ezz", lang: "en-US" }] },
  { id: "sh20-eg-henedy", group: "egyptian-art", queries: [{ type: "movie", q: "صعيدي في الجامعة الأمريكية", lang: "ar-EG" }, { type: "movie", q: "اللمبي", lang: "ar-EG" }, { type: "person", q: "Mohamed Henedy", lang: "en-US" }] },
  { id: "sh20-eg-plays", group: "egyptian-art", queries: [{ type: "movie", q: "مدرسة المشاغبين", lang: "ar-EG" }, { type: "movie", q: "العيال كبرت", lang: "ar-EG" }, { type: "movie", q: "شاهد ماشفش حاجة", lang: "ar-EG" }] },
  { id: "sh20-eg-saqqa", group: "egyptian-art", queries: [{ type: "movie", q: "الجزيرة", lang: "ar-EG" }, { type: "movie", q: "إبراهيم الأبيض", lang: "ar-EG" }, { type: "person", q: "Ahmed El Sakka", lang: "en-US" }] },
  { id: "sh20-eg-mekky", group: "egyptian-art", queries: [{ type: "movie", q: "طير إنت", lang: "ar-EG" }, { type: "movie", q: "لا تراجع ولا استسلام", lang: "ar-EG" }, { type: "movie", q: "الحرب العالمية الثالثة", lang: "ar-EG" }] },
  { id: "sh20-eg-bw", group: "egyptian-art", queries: [{ type: "movie", q: "إشاعة حب", lang: "ar-EG" }, { type: "movie", q: "أبي فوق الشجرة", lang: "ar-EG" }, { type: "person", q: "Soad Hosny", lang: "en-US" }] },
  { id: "sh20-eg-youssef", group: "egyptian-art", queries: [{ type: "tv", q: "ما وراء الطبيعة", lang: "ar-EG" }, { type: "tv", q: "Paranormal", lang: "en-US" }, { type: "tv", q: "كفر دلهاب", lang: "ar-EG" }] },

  // ================= الفن السوري (11 فئة) =================
  { id: "sh21-sy-babalhara", group: "syrian-art", queries: [{ type: "tv", q: "باب الحارة", lang: "ar-SY" }, { type: "tv", q: "Bab Al Hara", lang: "en-US" }] },
  { id: "sh21-sy-dayaa", group: "syrian-art", queries: [{ type: "tv", q: "ضيعة ضايعة", lang: "ar-SY" }, { type: "tv", q: "Dayaa Dayaa", lang: "en-US" }] },
  { id: "sh21-sy-maraya", group: "syrian-art", queries: [{ type: "tv", q: "مرايا", lang: "ar-SY" }, { type: "tv", q: "Maraya", lang: "en-US" }, { type: "person", q: "Yasser Al-Azma", lang: "en-US" }] },
  { id: "sh21-sy-fosool", group: "syrian-art", queries: [{ type: "tv", q: "الفصول الأربعة", lang: "ar-SY" }, { type: "tv", q: "عيلة خمس نجوم", lang: "ar-SY" }] },
  { id: "sh21-sy-boqaa", group: "syrian-art", queries: [{ type: "tv", q: "بقعة ضوء", lang: "ar-SY" }, { type: "tv", q: "الخربة", lang: "ar-SY" }] },
  { id: "sh21-sy-heiba", group: "syrian-art", queries: [{ type: "tv", q: "الهيبة", lang: "ar-SY" }, { type: "tv", q: "Al Hayba", lang: "en-US" }] },
  { id: "sh21-sy-history", group: "syrian-art", queries: [{ type: "tv", q: "الزير سالم", lang: "ar-SY" }, { type: "tv", q: "التغريبة الفلسطينية", lang: "ar-SY" }] },
  { id: "sh21-sy-ayman", group: "syrian-art", queries: [{ type: "tv", q: "يوميات جميل وهناء", lang: "ar-SY" }, { type: "tv", q: "يوميات مدير عام", lang: "ar-SY" }, { type: "person", q: "Ayman Zeidan", lang: "en-US" }] },
  { id: "sh21-sy-duraid", group: "syrian-art", queries: [{ type: "movie", q: "الحدود", lang: "ar-SY" }, { type: "tv", q: "صح النوم", lang: "ar-SY" }, { type: "person", q: "Duraid Lahham", lang: "en-US" }] },
  { id: "sh21-sy-shami", group: "syrian-art", queries: [{ type: "tv", q: "ليالي الصالحية", lang: "ar-SY" }, { type: "tv", q: "أهل الراية", lang: "ar-SY" }, { type: "tv", q: "أيام شامية", lang: "ar-SY" }] },
  { id: "sh21-sy-social", group: "syrian-art", queries: [{ type: "tv", q: "الولادة من الخاصرة", lang: "ar-SY" }, { type: "tv", q: "الندم", lang: "ar-SY" }, { type: "tv", q: "الانتظار", lang: "ar-SY" }] },

  // ================= مسلسلات وأفلام أجنبية (18 فئة) =================
  { id: "sh22-en-bb", group: "foreign-cinema", queries: [{ type: "tv", q: "Breaking Bad", lang: "en-US" }] },
  { id: "sh22-en-got", group: "foreign-cinema", queries: [{ type: "tv", q: "Game of Thrones", lang: "en-US" }] },
  { id: "sh22-en-vikings", group: "foreign-cinema", queries: [{ type: "tv", q: "Vikings", lang: "en-US" }] },
  { id: "sh22-en-lacasa", group: "foreign-cinema", queries: [{ type: "tv", q: "La Casa de Papel", lang: "en-US" }, { type: "tv", q: "Money Heist", lang: "en-US" }] },
  { id: "sh22-en-pb", group: "foreign-cinema", queries: [{ type: "tv", q: "Prison Break", lang: "en-US" }] },
  { id: "sh22-en-peaky", group: "foreign-cinema", queries: [{ type: "tv", q: "Peaky Blinders", lang: "en-US" }] },
  { id: "sh22-en-friends", group: "foreign-cinema", queries: [{ type: "tv", q: "Friends", lang: "en-US" }] },
  { id: "sh22-en-hp", group: "foreign-cinema", queries: [{ type: "movie", q: "Harry Potter and the Philosopher's Stone", lang: "en-US" }, { type: "movie", q: "Harry Potter", lang: "en-US" }] },
  { id: "sh22-en-marvel", group: "foreign-cinema", queries: [{ type: "movie", q: "Avengers: Endgame", lang: "en-US" }, { type: "movie", q: "The Avengers", lang: "en-US" }] },
  { id: "sh22-en-nolan", group: "foreign-cinema", queries: [{ type: "movie", q: "Interstellar", lang: "en-US" }, { type: "movie", q: "Inception", lang: "en-US" }] },
  { id: "sh22-en-stranger", group: "foreign-cinema", queries: [{ type: "tv", q: "Stranger Things", lang: "en-US" }] },
  { id: "sh22-en-twd", group: "foreign-cinema", queries: [{ type: "tv", q: "The Walking Dead", lang: "en-US" }] },
  { id: "sh22-en-squid", group: "foreign-cinema", queries: [{ type: "tv", q: "Squid Game", lang: "en-US" }] },
  { id: "sh22-en-fast", group: "foreign-cinema", queries: [{ type: "movie", q: "Furious 7", lang: "en-US" }, { type: "movie", q: "Fast & Furious", lang: "en-US" }] },
  { id: "sh22-en-dc", group: "foreign-cinema", queries: [{ type: "movie", q: "The Dark Knight", lang: "en-US" }, { type: "movie", q: "The Batman", lang: "en-US" }] },
  { id: "sh22-en-lotr", group: "foreign-cinema", queries: [{ type: "movie", q: "The Lord of the Rings: The Fellowship of the Ring", lang: "en-US" }, { type: "movie", q: "The Lord of the Rings", lang: "en-US" }] },
  { id: "sh22-en-disney", group: "foreign-cinema", queries: [{ type: "movie", q: "The Lion King", lang: "en-US" }, { type: "movie", q: "Toy Story", lang: "en-US" }] },
  { id: "sh22-en-horror", group: "foreign-cinema", queries: [{ type: "movie", q: "The Conjuring", lang: "en-US" }, { type: "movie", q: "IT", lang: "en-US" }] }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isBearerToken(key) {
  return typeof key === "string" && (key.startsWith("eyJ") || key.length > 64);
}

async function searchTmdbImagePath({ type, q, lang }) {
  const endpoint = type === "person" ? "search/person" : type === "movie" ? "search/movie" : "search/tv";
  const url = new URL(`${TMDB_API_BASE}/${endpoint}`);
  url.searchParams.set("query", q);
  if (lang) url.searchParams.set("language", lang);
  url.searchParams.set("include_adult", "false");

  const headers = { Accept: "application/json" };
  if (isBearerToken(EFFECTIVE_API_KEY)) {
    headers.Authorization = `Bearer ${EFFECTIVE_API_KEY}`;
  } else {
    url.searchParams.set("api_key", EFFECTIVE_API_KEY);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`TMDB HTTP ${res.status} (${q})`);
  }

  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  for (const item of results) {
    const imgPath = item?.poster_path || item?.profile_path || item?.backdrop_path;
    if (imgPath) {
      return imgPath;
    }
  }
  return null;
}

async function fetchAndSavePoster(category, forceOverwrite) {
  const outputFile = path.join(OUTPUT_DIR, `${category.id}.webp`);

  if (!forceOverwrite) {
    try {
      await fs.access(outputFile);
      return { status: "skipped", file: outputFile };
    } catch {
      // الملف غير موجود بعد -> نتابع التحميل
    }
  }

  let imagePath = null;
  let matchedQuery = "";

  for (const attempt of category.queries) {
    imagePath = await searchTmdbImagePath(attempt);
    if (imagePath) {
      matchedQuery = `${attempt.type}:${attempt.q}`;
      break;
    }
    await sleep(DELAY_MS);
  }

  if (!imagePath) {
    return { status: "not_found" };
  }

  const imgUrl = `${TMDB_IMAGE_BASE}${imagePath}`;
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) {
    throw new Error(`Image download HTTP ${imgRes.status} (${imgUrl})`);
  }

  const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
  await sharp(rawBuffer)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outputFile);

  return { status: "saved", file: outputFile, matchedQuery };
}

async function main() {
  const forceOverwrite = process.argv.includes("--force");

  if (!EFFECTIVE_API_KEY || EFFECTIVE_API_KEY === "YOUR_TMDB_API_KEY") {
    console.error("❌ يرجى وضع مفتاح TMDB API الحقيقي في المتغير API_KEY أعلى ملف fetch-posters.mjs (أو عبر متغير البيئة TMDB_API_KEY).");
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`🎬 جاري جلب بوسترات ${CATEGORIES.length} فئة إلى: ${OUTPUT_DIR}`);
  console.log(`⚙️ العرض: ${TARGET_WIDTH}px | الجودة: ${WEBP_QUALITY} | المهلة: ${DELAY_MS}ms\n`);

  let savedCount = 0;
  let skippedCount = 0;
  const failed = [];

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    const progress = `[${String(i + 1).padStart(2, "0")}/${CATEGORIES.length}]`;
    try {
      const res = await fetchAndSavePoster(cat, forceOverwrite);
      if (res.status === "saved") {
        savedCount++;
        console.log(`${progress} ✅ ${cat.id}.webp (${res.matchedQuery})`);
      } else if (res.status === "skipped") {
        skippedCount++;
        console.log(`${progress} ⏭️ ${cat.id}.webp (موجود مسبقاً)`);
      } else {
        failed.push({ id: cat.id, reason: "لم يُعثر على بوستر مطابق في TMDB" });
        console.warn(`${progress} ⚠️ ${cat.id}: لم يُعثر على بوستر مطابق`);
      }
    } catch (err) {
      failed.push({ id: cat.id, reason: err.message });
      console.error(`${progress} ❌ ${cat.id}: ${err.message}`);
    }

    if (i < CATEGORIES.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log("\n==========================================");
  console.log(`✅ تم الحفظ: ${savedCount} | ⏭️ تم التخطي: ${skippedCount} | ❌ فشل: ${failed.length}`);
  if (failed.length > 0) {
    console.log("الفئات التي تعذّر جلبها:");
    failed.forEach((f) => console.log(`  - ${f.id}: ${f.reason}`));
  }
}

main().catch((err) => {
  console.error("❌ خطأ غير متوقع:", err);
  process.exit(1);
});

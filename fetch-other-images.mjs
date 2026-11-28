/**
 * سكربت جلب صور باقي الفئات (168 فئة) وبطاقات المجموعات الرئيسية (9 مجموعات) من Pixabay API
 * وتحويلها وضغطها بصيغة WebP (عرض 600px، جودة 80) عبر مكتبة sharp
 *
 * الاستخدام:
 * 1) استبدل YOUR_PIXABAY_API_KEY بمفتاح Pixabay API الخاص بك (أو مرّره عبر PIXABAY_API_KEY)
 * 2) شغّل الأمر: node fetch-other-images.mjs
 *    (أضف --force لإعادة تحميل الصور الموجودة مسبقاً)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PIXABAY_API_KEY = "YOUR_PIXABAY_API_KEY";
const EFFECTIVE_PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || PIXABAY_API_KEY;

const DELAY_MS = 650;
const TARGET_WIDTH = 600;
const WEBP_QUALITY = 80;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATEGORIES_DIR = path.join(__dirname, "public", "images", "categories");
const GROUPS_DIR = path.join(__dirname, "public", "images", "groups");

/**
 * 1) البطاقات الرئيسية للمجموعات (9 مجموعات) -> public/images/groups/${id}.webp
 */
const MAIN_GROUPS = [
  { id: "culture-geo", query: "world map vintage globe library", fallback: "world map" },
  { id: "science-tech", query: "science laboratory galaxy technology", fallback: "space nebula" },
  { id: "jordan-arab", query: "petra jordan arabic architecture", fallback: "desert mosque" },
  { id: "sports-life", query: "football stadium sports action", fallback: "soccer stadium" },
  { id: "entertainment", query: "cinema theater stage spotlight", fallback: "movie theater" },
  { id: "puzzles", query: "chess board brain puzzle game", fallback: "puzzle pieces" },
  { id: "visual", query: "camera lens colorful photography", fallback: "camera lens" },
  { id: "charades", query: "theater comedy drama masks stage", fallback: "theater stage" },
  { id: "movies-series", query: "cinema popcorn film projector dark", fallback: "cinema screen" }
];

/**
 * 2) جميع الفئات الـ 168 الأخرى (خارج sh20, sh21, sh22) -> public/images/categories/${id}.webp
 */
const OTHER_CATEGORIES = [
  // --- الدفعة 1 ---
  { id: "sh1-geo", query: "world map globe", fallback: "earth globe" },
  { id: "sh1-sci", query: "astronomy space nebula telescope", fallback: "outer space" },
  { id: "sh1-hist", query: "ancient historical ruins monument", fallback: "ancient ruins" },
  { id: "sh1-tech", query: "modern technology microchip circuit", fallback: "circuit board" },
  { id: "sh1-arab-lit", query: "arabic calligraphy fountain pen book", fallback: "old books" },

  // --- الدفعة 2 ---
  { id: "sh2-jo", query: "petra jordan", fallback: "jordan desert" },
  { id: "sh2-isl", query: "islamic mosque architecture dome", fallback: "grand mosque" },
  { id: "sh2-food", query: "middle eastern food feast table", fallback: "gourmet food" },
  { id: "sh2-cars", query: "luxury sports car headlights", fallback: "sports car" },
  { id: "sh2-med", query: "medical stethoscope healthcare", fallback: "medical doctor" },

  // --- الدفعة 3 ---
  { id: "sh3-drama", query: "film clapperboard cinema camera", fallback: "movie camera" },
  { id: "sh3-fb", query: "soccer ball football stadium pitch", fallback: "football match" },
  { id: "sh3-prov", query: "vintage scroll antique book wisdom", fallback: "antique book" },
  { id: "sh3-rid", query: "rubik cube mystery lightbulb", fallback: "lightbulb idea" },
  { id: "sh3-cart", query: "retro television colorful toys nostalgia", fallback: "vintage television" },

  // --- الدفعة 5 (تحديات الأعلام) ---
  { id: "sh5-flags-blur", query: "international flags blurred colors", fallback: "world flags" },
  { id: "sh5-flags-zoom", query: "magnifying glass flags map", fallback: "flags waving" },
  { id: "sh5-flags-link", query: "two flags international summit", fallback: "united nations flags" },
  { id: "sh5-flags-mem", query: "colorful country flags sky", fallback: "flags row" },

  // --- الدفعة 6 ---
  { id: "sh6-animals", query: "african lion wildlife safari", fallback: "wild animals" },
  { id: "sh6-brands", query: "modern corporate skyscraper business", fallback: "business skyline" },
  { id: "sh6-sports", query: "olympic running track athletics", fallback: "stadium athletics" },
  { id: "sh6-cinema", query: "hollywood red carpet film reel", fallback: "cinema film" },
  { id: "sh6-cur", query: "world currency banknotes coins", fallback: "money banknotes" },

  // --- الدفعة 7 ---
  { id: "sh7-music", query: "oud arabic musical instrument", fallback: "acoustic guitar concert" },
  { id: "sh7-gaming", query: "video game controller neon setup", fallback: "gaming controller" },
  { id: "sh7-landmarks", query: "eiffel tower pyramids world wonders", fallback: "colosseum rome" },
  { id: "sh7-arab-geo", query: "dubai cairo skyline arab city", fallback: "arab city night" },
  { id: "sh7-inventions", query: "vintage lightbulb blueprint gears", fallback: "vintage gears" },

  // --- فئات من غير كلام (mgk-*) ---
  { id: "mgk-general", query: "friends laughing party game living room", fallback: "party games" },
  { id: "mgk-movies", query: "movie clapperboard director chair", fallback: "film reel" },
  { id: "mgk-series", query: "cozy tv watching popcorn sofa", fallback: "television remote" },
  { id: "mgk-food", query: "colorful burger pizza drinks table", fallback: "street food" },
  { id: "mgk-proverbs", query: "arabic lantern traditional coffee tea", fallback: "vintage lantern" },
  { id: "mgk-jobs", query: "chef doctor firefighter professions", fallback: "chef cooking" },
  { id: "mgk-situations", query: "funny surprised expression people", fallback: "friends laughing" },
  { id: "mgk-songs", query: "vintage microphone singing stage", fallback: "stage microphone" },
  { id: "mgk-animals", query: "cute monkey elephant parrot zoo", fallback: "wildlife zoo" },
  { id: "mgk-sports", query: "basketball tennis swimming sports", fallback: "sports equipment" },

  // --- الدفعة 8 ---
  { id: "sh8-jo-dial", query: "amman jordan old street cafe", fallback: "jordan tea" },
  { id: "sh8-records", query: "gold trophy mountain peak tallest", fallback: "golden trophy" },
  { id: "sh8-psych", query: "human brain psychology mind portrait", fallback: "thinking person" },
  { id: "sh8-firstaid", query: "first aid kit ambulance medical", fallback: "first aid" },
  { id: "sh8-cultures", query: "traditional cultural festival costumes", fallback: "cultural dance" },

  // --- الدفعة 9 ---
  { id: "sh9-tf", query: "checkmark cross question mark quiz", fallback: "question mark" },
  { id: "sh9-odd", query: "one red apple among green apples", fallback: "stand out crowd" },
  { id: "sh9-math", query: "mathematics equations chalkboard calculator", fallback: "chalkboard math" },
  { id: "sh9-quotes", query: "quill pen poetry manuscript notebook", fallback: "vintage writing" },
  { id: "sh9-travel", query: "airplane wing passport airport window", fallback: "airplane sky" },

  // --- الدفعة 10 ---
  { id: "sh10-firsts", query: "astronaut moon landing history pioneer", fallback: "astronaut space" },

  // --- الدفعة 11 ---
  { id: "sh11-emoji", query: "yellow smiley emoji faces colorful", fallback: "colorful stickers" },
  { id: "sh11-who", query: "mysterious silhouette spotlight portrait", fallback: "shadow silhouette" },
  { id: "sh11-lyrics", query: "headphones musical notes neon", fallback: "headphones music" },
  { id: "sh11-older", query: "hourglass antique pocket watch time", fallback: "hourglass sand" },
  { id: "sh11-list3", query: "stopwatch countdown timer three", fallback: "stopwatch timer" },

  // --- الدفعة 12 ---
  { id: "sh12-amman", query: "amman citadel jordan skyline", fallback: "amman jordan" },
  { id: "sh12-90s", query: "cassette tape retro gameboy 90s", fallback: "cassette tape" },
  { id: "sh12-turkish", query: "istanbul bosphorus bridge sunset turkey", fallback: "istanbul turkey" },
  { id: "sh12-prophets", query: "desert sunrise golden light mosque", fallback: "desert sunrise" },
  { id: "sh12-hazazeer", query: "arabic lantern night storytelling", fallback: "moroccan lantern" },

  // --- الدفعة 13 ---
  { id: "sh13-coffee", query: "espresso coffee cup roasted beans", fallback: "coffee latte art" },
  { id: "sh13-perfume", query: "luxury glass perfume bottle gold", fallback: "perfume bottle" },
  { id: "sh13-oceans", query: "deep ocean coral reef underwater whale", fallback: "underwater ocean" },
  { id: "sh13-ai", query: "artificial intelligence robot futuristic neon", fallback: "futuristic technology" },
  { id: "sh13-detective", query: "detective magnifying glass mystery noir", fallback: "magnifying glass" },

  // --- من غير كلام إضافية ---
  { id: "mgk-traditions", query: "arabic coffee dallah hospitality celebration", fallback: "arabic coffee" },
  { id: "mgk-celebs", query: "star spotlight hollywood walk fame", fallback: "stage spotlight" },
  { id: "mgk-tech", query: "smartphone laptop smart home gadgets", fallback: "modern gadgets" },

  // --- الدفعة 14 ---
  { id: "sh14-link", query: "connecting puzzle pieces chain link", fallback: "jigsaw puzzle" },
  { id: "sh14-bigger", query: "balance scale comparison giant mountain", fallback: "balance scale" },
  { id: "sh14-country3", query: "compass vintage travel map pins", fallback: "compass map" },
  { id: "sh14-movie3", query: "cinema tickets popcorn film strip", fallback: "popcorn movie" },
  { id: "sh14-dish-ing", query: "fresh cooking ingredients wooden kitchen table", fallback: "cooking ingredients" },
  { id: "sh14-lit-trans", query: "dictionary translation books funny", fallback: "dictionary book" },
  { id: "sh14-anagram", query: "scrabble letter tiles wooden game", fallback: "letter tiles" },
  { id: "sh14-prov-gap", query: "open book missing piece pen", fallback: "open book" },
  { id: "sh14-timeline", query: "vintage clocks timeline calendar history", fallback: "vintage clock" },
  { id: "sh14-odd-who", query: "chess king pawns group contrast", fallback: "chess pieces" },
  { id: "sh14-etym", query: "ancient library multilingual manuscripts", fallback: "historic library" },
  { id: "sh14-myth-hist", query: "antique newspaper archive historical mystery", fallback: "old newspaper" },
  { id: "sh14-job-tools", query: "workshop tools hammer wrench stethoscope", fallback: "tools flatlay" },
  { id: "sh14-inv-clue", query: "edison lightbulb vintage workshop patent", fallback: "vintage lightbulb" },
  { id: "sh14-spatial", query: "geometric mirror optical illusion clock", fallback: "optical illusion" },

  // --- الدفعة 15 ---
  { id: "sh15-seq", query: "domino chain sequence numbers pattern", fallback: "dominoes" },
  { id: "sh15-speed5", query: "lightning bolt fast stopwatch neon", fallback: "lightning storm" },
  { id: "sh15-city-nick", query: "city skyline night lights panorama", fallback: "city night" },
  { id: "sh15-country-mean", query: "atlas world map calligraphy compass", fallback: "atlas map" },
  { id: "sh15-acronyms", query: "keyboard letters typography neon signs", fallback: "neon letters" },
  { id: "sh15-emoji-prov", query: "colorful wooden blocks icons playful", fallback: "colorful blocks" },
  { id: "sh15-emoji-geo", query: "miniature globe travel suitcase stickers", fallback: "travel suitcase" },
  { id: "sh15-emoji-song", query: "vinyl record musical notes colorful", fallback: "vinyl record" },
  { id: "sh15-fix-err", query: "red pen editing checklist paper", fallback: "editing notebook" },
  { id: "sh15-same-letter", query: "alphabet letters blocks typography", fallback: "alphabet letters" },
  { id: "sh15-year", query: "vintage calendar flip clock years", fallback: "calendar dates" },
  { id: "sh15-homonym", query: "open dictionary magnifying glass words", fallback: "reading book" },
  { id: "sh15-locked", query: "vintage brass key locked door mystery", fallback: "antique key" },
  { id: "sh15-antonym", query: "black and white yin yang contrast", fallback: "black white contrast" },
  { id: "sh15-team3", query: "football jerseys locker room stadium", fallback: "soccer team" },

  // --- الدفعة 16 (تحديات بصرية) ---
  { id: "sh16-blur-brand", query: "neon shopping mall bokeh city lights", fallback: "city bokeh" },
  { id: "sh16-blur-club", query: "football stadium floodlights bokeh night", fallback: "stadium lights" },
  { id: "sh16-blur-car", query: "car emblem steering wheel blurred night", fallback: "car headlights" },
  { id: "sh16-blur-movie", query: "cinema hall blurred screen projector", fallback: "movie projector" },
  { id: "sh16-blur-cart", query: "colorful animation drawing studio bokeh", fallback: "colorful painting" },
  { id: "sh16-blur-land", query: "famous monument sunset soft focus", fallback: "paris sunset" },
  { id: "sh16-blur-celeb", query: "paparazzi camera flash red carpet silhouette", fallback: "camera flash" },
  { id: "sh16-zoom-brand", query: "macro closeup metallic texture modern", fallback: "macro metal" },
  { id: "sh16-zoom-car", query: "macro car headlight grille closeup", fallback: "car grille" },
  { id: "sh16-zoom-land", query: "closeup ancient stone carving architecture", fallback: "stone architecture" },
  { id: "sh16-zoom-ani", query: "closeup tiger eye leopard fur macro", fallback: "animal eye macro" },
  { id: "sh16-zoom-food", query: "macro strawberry citrus fruit texture", fallback: "fruit closeup" },
  { id: "sh16-zoom-obj", query: "macro watch gears mechanical closeup", fallback: "mechanical macro" },
  { id: "sh16-zoom-cur", query: "macro banknote paper money details", fallback: "dollar bill closeup" },
  { id: "sh16-link-word", query: "two polaroid photos collage desk", fallback: "polaroid photos" },
  { id: "sh16-link-play", query: "soccer player boots ball grass closeup", fallback: "soccer cleats" },
  { id: "sh16-link-city", query: "postcards world landmarks travel map", fallback: "travel postcards" },
  { id: "sh16-link-inv", query: "science experiment flask lightbulb desk", fallback: "chemistry flask" },
  { id: "sh16-link-cart", query: "comic book colorful illustration drawing", fallback: "comic drawing" },
  { id: "sh16-link-3pic", query: "photo gallery frames wall collage", fallback: "photo frames" },
  { id: "sh16-mem-logo", query: "colorful geometric shapes memory abstract", fallback: "geometric abstract" },
  { id: "sh16-mem-scene", query: "busy street market colorful scene", fallback: "colorful market" },
  { id: "sh16-map-shape", query: "world map silhouette cartography borders", fallback: "cartography map" },
  { id: "sh16-jersey", query: "football jersey shirt stadium", fallback: "soccer jersey" },
  { id: "sh16-signs", query: "road traffic signs highway street", fallback: "traffic sign" },

  // --- الدفعة 17 ---
  { id: "sh17-anime", query: "tokyo neon street japan anime aesthetic", fallback: "tokyo night" },
  { id: "sh17-tv-world", query: "streaming tv dark living room cinema", fallback: "home theater" },
  { id: "sh17-theater", query: "red velvet theater curtains stage", fallback: "theater stage" },
  { id: "sh17-disney", query: "fairytale castle fireworks night magic", fallback: "castle fireworks" },
  { id: "sh17-heroes", query: "superhero comic city night skyline neon", fallback: "comic city" },
  { id: "sh17-horror", query: "haunted dark forest fog spooky house", fallback: "foggy dark forest" },
  { id: "sh17-comedy", query: "stand up comedy microphone spotlight", fallback: "laughing theater" },
  { id: "sh17-tvshows", query: "television broadcast studio lights cameras", fallback: "tv studio" },
  { id: "sh17-wmusic", query: "music concert crowd stage lights", fallback: "rock concert" },
  { id: "sh17-wc", query: "world cup football stadium celebration", fallback: "soccer trophy" },
  { id: "sh17-ucl", query: "european football stadium night lights", fallback: "football stadium night" },
  { id: "sh17-arab-fb", query: "football fans stadium flags celebration", fallback: "soccer fans" },
  { id: "sh17-fb-rec", query: "golden football boot trophy pitch", fallback: "football pitch" },
  { id: "sh17-combat", query: "boxing ring gloves mma octagon", fallback: "boxing gloves" },
  { id: "sh17-f1", query: "formula 1 racing car track speed", fallback: "race car track" },
  { id: "sh17-fitness", query: "gym dumbbells fitness workout nutrition", fallback: "gym weights" },
  { id: "sh17-sweets", query: "baklava arabic desserts chocolate cake", fallback: "pastry desserts" },
  { id: "sh17-spices", query: "colorful spices herbs market bowls", fallback: "spices bowls" },
  { id: "sh17-luxury", query: "luxury swiss watch diamonds gold", fallback: "luxury wristwatch" },
  { id: "sh17-traffic", query: "highway driving steering wheel traffic light", fallback: "traffic light" },

  // --- الدفعة 18 ---
  { id: "sh18-jo-gov", query: "wadi rum jerash jordan landscape", fallback: "wadi rum jordan" },
  { id: "sh18-sahaba", query: "medina islamic green dome architecture", fallback: "islamic arch" },
  { id: "sh18-battles", query: "medieval arabian desert horses fortress", fallback: "desert fortress" },
  { id: "sh18-quran", query: "open quran mosque warm light", fallback: "quran book" },
  { id: "sh18-andalus", query: "alhambra granada islamic architecture spain", fallback: "alhambra spain" },
  { id: "sh18-dialects", query: "traditional arab souq bazaar market", fallback: "arab market" },
  { id: "sh18-leaders", query: "historic arab castle monument heritage", fallback: "ancient castle" },
  { id: "sh18-badia", query: "bedouin desert tent camels starry night", fallback: "desert camels" },
  { id: "sh18-ramadan", query: "ramadan crescent lantern dates night", fallback: "ramadan lantern" },
  { id: "sh18-scholars", query: "antique astrolabe islamic manuscripts science", fallback: "antique compass" },

  // --- الدفعة 19 ---
  { id: "sh19-weather", query: "aurora borealis volcano lightning storm", fallback: "aurora borealis" },
  { id: "sh19-plants", query: "tropical botanical garden lush green trees", fallback: "green forest plants" },
  { id: "sh19-dinos", query: "dinosaur skeleton fossil museum prehistoric", fallback: "dinosaur fossil" },
  { id: "sh19-space-adv", query: "deep space galaxy milky way black hole", fallback: "milky way galaxy" },
  { id: "sh19-chem", query: "chemistry laboratory colorful flasks test tubes", fallback: "chemistry lab" },
  { id: "sh19-physics", query: "prism light rainbow physics electricity", fallback: "light prism" },
  { id: "sh19-pharma", query: "pharmacy medicine capsules vitamins bottles", fallback: "medicine pills" },
  { id: "sh19-insects", query: "colorful butterfly eagle chameleon macro", fallback: "butterfly macro" },
  { id: "sh19-cyber", query: "cybersecurity padlock code server matrix", fallback: "computer code" },
  { id: "sh19-biz", query: "startup entrepreneurs modern glass office", fallback: "modern office" },
  { id: "sh19-finance", query: "stock market chart bitcoin gold coins", fallback: "stock chart" },
  { id: "sh19-arch", query: "burj khalifa skyscraper modern architecture", fallback: "modern skyscraper" },
  { id: "sh19-art", query: "art museum oil painting canvas gallery", fallback: "art gallery" },
  { id: "sh19-myth", query: "greek parthenon egyptian pyramids ancient temple", fallback: "ancient temple" },
  { id: "sh19-natgeo", query: "majestic mountain river island waterfall", fallback: "mountain waterfall" }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const usedPhotoIds = new Set();

async function searchPixabayPhoto(query) {
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(EFFECTIVE_PIXABAY_API_KEY)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=3&safesearch=true`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (res.status === 429) {
    throw new Error("PIXABAY_RATE_LIMIT (HTTP 429) — أعد تشغيل السكربت لاحقاً وسيتخطى الصور المحفوظة تلقائياً");
  }
  if (!res.ok) {
    throw new Error(`Pixabay HTTP ${res.status} (${query})`);
  }

  const data = await res.json();
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  if (hits.length === 0) return null;

  // اختيار أول صورة غير مستخدمة مسبقاً لتنويع البطاقات (أو الأولى كخيار افتراضي)
  const fresh = hits.find((h) => h && !usedPhotoIds.has(h.id)) || hits[0];
  const imgUrl = fresh?.largeImageURL || fresh?.webformatURL;
  if (!imgUrl) return null;

  usedPhotoIds.add(fresh.id);
  return { id: fresh.id, url: imgUrl };
}

async function fetchItemImage(item, outputDir, { forceOverwrite = false } = {}) {
  const outputFile = path.join(outputDir, `${item.id}.webp`);

  if (!forceOverwrite) {
    try {
      await fs.access(outputFile);
      return { status: "skipped", file: outputFile };
    } catch {
      // الملف غير موجود بعد -> نتابع التحميل
    }
  }

  const attempts = [item.query, item.fallback].filter(Boolean);
  let found = null;
  let usedQuery = "";

  for (let i = 0; i < attempts.length; i++) {
    const q = attempts[i];
    found = await searchPixabayPhoto(q);
    if (found) {
      usedQuery = q;
      break;
    }
    if (i < attempts.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  if (!found) {
    return { status: "not_found" };
  }

  const imgRes = await fetch(found.url);
  if (!imgRes.ok) {
    throw new Error(`Image download HTTP ${imgRes.status} (${found.url})`);
  }

  const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
  await sharp(rawBuffer)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outputFile);

  return { status: "saved", file: outputFile, usedQuery, photoId: found.id };
}

async function runBatch(label, items, outputDir, { forceOverwrite }) {
  const saved = [];
  const skipped = [];
  const failed = [];

  console.log(`\n🖼️ === ${label} (${items.length} عنصر) ===`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const progress = `[${String(i + 1).padStart(3, "0")}/${items.length}]`;
    try {
      const res = await fetchItemImage(item, outputDir, { forceOverwrite });
      if (res.status === "saved") {
        saved.push(item.id);
        console.log(`${progress} ✅ ${item.id}.webp ("${res.usedQuery}")`);
      } else if (res.status === "skipped") {
        skipped.push(item.id);
        console.log(`${progress} ⏭️ ${item.id}.webp (موجود مسبقاً)`);
      } else {
        failed.push({ id: item.id, query: item.query, reason: "لم تُرجع Pixabay أي نتائج" });
        console.warn(`${progress} ⚠️ ${item.id}: لا توجد نتائج مطابقة`);
      }
    } catch (err) {
      failed.push({ id: item.id, query: item.query, reason: err.message });
      console.error(`${progress} ❌ ${item.id}: ${err.message}`);
    }

    if (i < items.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  return { saved, skipped, failed };
}

async function main() {
  const forceOverwrite = process.argv.includes("--force");

  if (!EFFECTIVE_PIXABAY_API_KEY || EFFECTIVE_PIXABAY_API_KEY === "YOUR_PIXABAY_API_KEY") {
    console.error("❌ يرجى وضع مفتاح Pixabay API الحقيقي في المتغير PIXABAY_API_KEY أعلى ملف fetch-other-images.mjs (أو عبر متغير البيئة PIXABAY_API_KEY).");
    process.exit(1);
  }

  await fs.mkdir(CATEGORIES_DIR, { recursive: true });
  await fs.mkdir(GROUPS_DIR, { recursive: true });

  console.log(`🚀 بدء جلب صور Pixabay لـ ${MAIN_GROUPS.length} بطاقات مجموعات رئيسية + ${OTHER_CATEGORIES.length} فئة فرعية`);
  console.log(`⚙️ العرض: ${TARGET_WIDTH}px | الجودة: ${WEBP_QUALITY} | المهلة: ${DELAY_MS}ms`);

  const groupsReport = await runBatch("البطاقات الرئيسية للمجموعات (groups)", MAIN_GROUPS, GROUPS_DIR, {
    forceOverwrite
  });

  const catsReport = await runBatch("الفئات الفرعية الأخرى (categories)", OTHER_CATEGORIES, CATEGORIES_DIR, {
    forceOverwrite
  });

  const allSaved = [...groupsReport.saved, ...catsReport.saved];
  const allSkipped = [...groupsReport.skipped, ...catsReport.skipped];
  const allFailed = [...groupsReport.failed, ...catsReport.failed];

  console.log("\n========================================================");
  console.log("📊 التقرير النهائي لجلب صور Pixabay:");
  console.log(`   • المجموعات الرئيسية: ✅ ${groupsReport.saved.length} | ⏭️ ${groupsReport.skipped.length} | ❌ ${groupsReport.failed.length}`);
  console.log(`   • الفئات الفرعية:     ✅ ${catsReport.saved.length} | ⏭️ ${catsReport.skipped.length} | ❌ ${catsReport.failed.length}`);
  console.log(`   • الإجمالي الكلي:     ✅ ${allSaved.length} تم تحميلها | ⏭️ ${allSkipped.length} تم تخطيها | ❌ ${allFailed.length} فشل`);
  console.log("========================================================");

  if (allSaved.length > 0) {
    console.log(`\n✅ الصور التي تم تحميلها بنجاح (${allSaved.length}):`);
    console.log(`   ${allSaved.join(", ")}`);
  }

  if (allFailed.length > 0) {
    console.log(`\n❌ العناصر التي فشل تحميلها للمراجعة اليدوية (${allFailed.length}):`);
    allFailed.forEach((f) => {
      console.log(`   - ${f.id} [query: "${f.query}"]: ${f.reason}`);
    });
  }
}

main().catch((err) => {
  console.error("❌ خطأ غير متوقع:", err);
  process.exit(1);
});

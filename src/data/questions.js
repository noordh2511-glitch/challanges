/**
 * بنك أسئلة لعبة "سين جيم" (Seen Jeem)
 * ------------------------------------------------------------
 * طريقة التعديل أو إضافة أسئلة جديدة:
 * - كل فئة تحتوي على: id فريد، name اسم الفئة، icon رمز تعبيري، color لون مميز، description وصف قصير، ومصفوفة questions.
 * - كل سؤال يحتوي على:
 *   - id: معرّف فريد لا يتكرر أبداً (يُحفظ في localStorage لمنع تكرار السؤال في الجولات القادمة)
 *   - points: قيمة السؤال (200 أو 400 أو 600)
 *   - question: نص السؤال
 *   - answer: الإجابة الصحيحة
 *   - questionImage: رابط أو مسار صورة اختيارية للسؤال (اتركه "" إذا لا توجد صورة)
 *   - answerImage: رابط أو مسار صورة اختيارية للإجابة (اتركه "" إذا لا توجد صورة)
 *   - visualType (اختياري، الافتراضي "normal"): نوع السؤال البصري التفاعلي:
 *       "normal"      : سؤال عادي نصي أو بصورة عادية
 *       "blur"        : صورة مغبشة (افتراضياً 18px) مع زر «تخفيف التغبيش (تلميح)» وتوضيح كامل عند كشف الإجابة
 *       "zoom"        : صورة مقربة جداً (افتراضياً scale 3.8) مع زر «تخفيف الزوم (تلميح)» وتوضيح كامل عند كشف الإجابة
 *       "invert"      : صورة بألوان معكوسة تعود لطبيعتها عند كشف الإجابة
 *       "silhouette"  : ظل أسود (للصور الشفافة PNG/SVG) يكشف ألوانه الأصلية عند كشف الإجابة
 *       "memory"      : تظهر الصورة وحدها لمدة memorySeconds (الافتراضي 10 ثوانٍ) ثم تختفي ليظهر السؤال
 *       "spot-diff"   : صورتان جنباً إلى جنب من مصفوفة images + answerImage لتوضيح الفروقات
 *       "multi-image" : شبكة متجاوبة من 2 إلى 4 صور من مصفوفة images لأسئلة "اربط الصور"
 *   - blurLevel (اختياري لنوع blur): شدة التغبيش بالبكسل (الافتراضي 18)
 *   - zoomLevel (اختياري لنوع zoom): نسبة التقريب الشديد (الافتراضي 3.8)
 *   - zoomOrigin (اختياري لنوع zoom): إحداثيات نقطة التقريب مثل "50% 50%" أو "35% 65%" (الافتراضي "center center")
 *   - memorySeconds (اختياري لنوع memory): مدة عرض الصورة بالثواني قبل اختفائها (الافتراضي 10)
 *   - differencesCount (اختياري لنوع spot-diff): عدد الفروقات المطلوب إيجادها (مثل 3 أو 4 أو 5) لعرضه كشارة أعلى الصورتين
 *   - showPlus (اختياري لنوع multi-image): true لإظهار علامة (+) بين الصور عند دمج معانيها، أو false لإخفائها
 *   - hint (اختياري): نص تلميح يظهر بزر «إظهار التلميح» قبل كشف الإجابة
 *   - explanation (اختياري): نص توضيحي يظهر أسفل الإجابة الصحيحة لشرح العلاقة بين الصور
 *   - images (اختياري لنوعي spot-diff و multi-image): مصفوفة مسارات نسبية أو روابط الصور (مثل ["images/multi-image/q1-1.svg", "images/multi-image/q1-2.svg"])
 *
 * ملاحظة: يمكنك إضافة أكثر من 6 أسئلة لكل فئة (مثلاً 12 أو 18 سؤالاً)، وستقوم اللعبة
 * تلقائياً باختيار الأسئلة الجديدة غير الملعوبة في كل جولة!
 */

window.SEEN_JEEM_DATA = {
  categories: [
    {
      id: "geography",
      name: "جغرافيا",
      icon: "🌍",
      color: "#06b6d4",
      description: "دول وعواصم ومعالم العالم",
      questions: [
        {
          id: "geo-200-1",
          points: 200,
          question: "ما هي أكبر دولة عربية من حيث المساحة؟",
          answer: "الجزائر",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "geo-200-2",
          points: 200,
          question: "ما هو أطول نهر في قارة أفريقيا؟",
          answer: "نهر النيل",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "geo-400-1",
          points: 400,
          question: "ما هو المضيق الذي يفصل بين قارتي آسيا وأمريكا الشمالية؟",
          answer: "مضيق بيرنغ",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "geo-400-2",
          points: 400,
          question: "ما هي العاصمة الرسمية لدولة أستراليا؟",
          answer: "كانبرا",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "geo-600-1",
          points: 600,
          question: "ما هي الدولة التي تمتلك أطول خط ساحلي في العالم؟",
          answer: "كندا (بأكثر من 202 ألف كيلومتر)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "geo-600-2",
          points: 600,
          question: "ما هي أكبر جزيرة غير قارية في العالم من حيث المساحة؟",
          answer: "جزيرة غرينلاند",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "science",
      name: "علوم",
      icon: "🔬",
      color: "#10b981",
      description: "فيزياء وكيمياء وأحياء وفضاء",
      questions: [
        {
          id: "sci-200-1",
          points: 200,
          question: "ما هو الرمز الكيميائي لعنصر الذهب في الجدول الدوري؟",
          answer: "Au",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "sci-200-2",
          points: 200,
          question: "ما هو أكبر كوكب في المجموعة الشمسية؟",
          answer: "كوكب المشتري",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "sci-400-1",
          points: 400,
          question: "ما هو الفيتامين الذي يُنتجه جسم الإنسان بشكل أساسي عند التعرض لأشعة الشمس؟",
          answer: "فيتامين د (Vitamin D)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "sci-400-2",
          points: 400,
          question: "كم عدد الحجرات في قلب الإنسان؟",
          answer: "4 حجرات (أذينان وبطينان)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "sci-600-1",
          points: 600,
          question: "ما هو الفلز الوحيد الذي يوجد في الحالة السائلة عند درجة حرارة الغرفة؟",
          answer: "الزئبق (Hg)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "sci-600-2",
          points: 600,
          question: "ما اسم العملية الفيزيائية التي تتحول فيها المادة مباشرةً من الحالة الصلبة إلى الغازية دون المرور بالحالة السائلة؟",
          answer: "التسامي (Sublimation)",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "history",
      name: "تاريخ",
      icon: "🏛️",
      color: "#f59e0b",
      description: "حضارات وأحداث وشخصيات خالدة",
      questions: [
        {
          id: "his-200-1",
          points: 200,
          question: "في أي دولة عربية تقع آثار مدينة تدمر التاريخية؟",
          answer: "سوريا",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "his-200-2",
          points: 200,
          question: "من هو القائد المسلم الذي انتصر في معركة حطين وحرر القدس عام 1187م؟",
          answer: "صلاح الدين الأيوبي",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "his-400-1",
          points: 400,
          question: "في أي عام سقط جدار برلين؟",
          answer: "عام 1989م",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "his-400-2",
          points: 400,
          question: "من هو العالم المسلم الذي يُعد مؤسس علم الجبر ومؤلف كتاب «المختصر في حساب الجبر والمقابلة»؟",
          answer: "محمد بن موسى الخوارزمي",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "his-600-1",
          points: 600,
          question: "ما اسم المعاهدة التي أنهت الحرب العالمية الأولى رسمياً بين ألمانيا والحلفاء عام 1919م؟",
          answer: "معاهدة فرساي",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "his-600-2",
          points: 600,
          question: "في أي مدينة مغربية أُسِّست جامعة القرويين التي تُعد أقدم جامعة مستمرة في العالم؟",
          answer: "مدينة فاس (أسستها فاطمة الفهرية عام 859م)",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "sports",
      name: "رياضة",
      icon: "⚽",
      color: "#ef4444",
      description: "كرة قدم وبطولات وأرقام قياسية",
      questions: [
        {
          id: "spo-200-1",
          points: 200,
          question: "كم عدد اللاعبين الأساسيين لكل فريق داخل ملعب كرة القدم عند انطلاق المباراة؟",
          answer: "11 لاعباً",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "spo-200-2",
          points: 200,
          question: "ما هي الدولة الأكثر تتويجاً ببطولة كأس العالم لكرة القدم عبر التاريخ؟",
          answer: "البرازيل (5 ألقاب)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "spo-400-1",
          points: 400,
          question: "ما هي الدولة التي استضافت أول بطولة لكأس العالم لكرة القدم عام 1930م؟",
          answer: "الأوروغواي",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "spo-400-2",
          points: 400,
          question: "كم تبلغ مدة الربع (الشوط) الواحد في مباراة كرة السلة وفق قوانين الاتحاد الدولي (FIBA)؟",
          answer: "10 دقائق",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "spo-600-1",
          points: 600,
          question: "من هو أول منتخب عربي وأفريقي نجح في بلوغ نصف نهائي كأس العالم لكرة القدم؟",
          answer: "منتخب المغرب (مونديال قطر 2022)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "spo-600-2",
          points: 600,
          question: "ما هي الرياضة التي تُعرف فيها البطولات الأربع الكبرى باسم «غراند سلام» (Grand Slam)؟",
          answer: "كرة المضرب (التنس)",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "technology",
      name: "تقنية",
      icon: "💻",
      color: "#8b5cf6",
      description: "حواسيب وبرمجة وإنترنت وابتكارات",
      questions: [
        {
          id: "tec-200-1",
          points: 200,
          question: "ماذا يعني الاختصار «CPU» في عالم الحواسيب؟",
          answer: "وحدة المعالجة المركزية (Central Processing Unit)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "tec-200-2",
          points: 200,
          question: "ما هي اللغة الأساسية المستخدمة في بناء هيكل صفحات الويب؟",
          answer: "لغة HTML",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "tec-400-1",
          points: 400,
          question: "من هو العالِم البريطاني الذي اخترع الشبكة العنكبوتية العالمية (World Wide Web) عام 1989؟",
          answer: "تيم بيرنرز لي (Tim Berners-Lee)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "tec-400-2",
          points: 400,
          question: "كم عدد البتّات (Bits) الموجودة في البايت (Byte) الواحد؟",
          answer: "8 بتّات",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "tec-600-1",
          points: 600,
          question: "ما اسم النظام المسؤول عن ترجمة أسماء النطاقات (مثل google.com) إلى عناوين IP رقمية؟",
          answer: "نظام أسماء النطاقات DNS (Domain Name System)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "tec-600-2",
          points: 600,
          question: "في أي عام أطلقت شركة أبل أول هاتف «آيفون» (iPhone) في التاريخ؟",
          answer: "عام 2007م",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "general",
      name: "معلومات عامة",
      icon: "💡",
      color: "#3b82f6",
      description: "ثقافة شاملة ومعرفة متنوعة",
      questions: [
        {
          id: "gen-200-1",
          points: 200,
          question: "كم عدد ألوان قوس قزح الأساسية؟",
          answer: "7 ألوان",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "gen-200-2",
          points: 200,
          question: "ما هو أسرع حيوان بري في العالم؟",
          answer: "الفهد الصياد (الشيتا)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "gen-400-1",
          points: 400,
          question: "كم عدد القلوب التي يمتلكها حيوان الأخطبوط؟",
          answer: "3 قلوب",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "gen-400-2",
          points: 400,
          question: "ما هي العملة الرسمية لدولة اليابان؟",
          answer: "الين الياباني",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "gen-600-1",
          points: 600,
          question: "ما هي الجائزة العالمية الشهيرة التي تُمنح سنوياً في السويد والنرويج ولا تضم فرعاً خاصاً للرياضيات؟",
          answer: "جائزة نوبل",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "gen-600-2",
          points: 600,
          question: "في أي مدينة أوروبية يقع المقر الرئيسي لمحكمة العدل الدولية؟",
          answer: "مدينة لاهاي في هولندا",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "jordan",
      name: "الأردن",
      icon: "🏜️",
      color: "#ec4899",
      description: "تاريخ وجغرافيا ومعالم الأردن",
      questions: [
        {
          id: "jor-200-1",
          points: 200,
          question: "ما هي المدينة الأردنية الوردية المُدرجة ضمن عجائب الدنيا السبع الجديدة؟",
          answer: "البتراء (البترا)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "jor-200-2",
          points: 200,
          question: "ما هو اسم الميناء البحري الوحيد في المملكة الأردنية الهاشمية؟",
          answer: "ميناء العقبة",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "jor-400-1",
          points: 400,
          question: "في أي يوم وشهر يحتفل الأردن بعيد الاستقلال؟",
          answer: "25 أيار (مايو) من كل عام",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "jor-400-2",
          points: 400,
          question: "ما هو اسم الوادي الصحراوي الشهير في جنوب الأردن المعروف بلقب «وادي القمر»؟",
          answer: "وادي رم",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "jor-600-1",
          points: 600,
          question: "ما هي أعلى قمة جبلية في المملكة الأردنية الهاشمية؟",
          answer: "جبل أم الدامي (1854 متراً فوق سطح البحر)",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "jor-600-2",
          points: 600,
          question: "ما اسم القلعة التاريخية في شمال الأردن التي بناها عز الدين أسامة أحد قادة صلاح الدين الأيوبي عام 1184م؟",
          answer: "قلعة عجلون (قلعة الربض)",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "riddles",
      name: "ألغاز وأمثال",
      icon: "🧩",
      color: "#14b8a6",
      description: "ذكاء وسرعة بديهة وأمثال عربية",
      questions: [
        {
          id: "rid-200-1",
          points: 200,
          question: "أكمل المثل العربي الشهير: «الصديق وقت ...»؟",
          answer: "الضيق",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "rid-200-2",
          points: 200,
          question: "ما هو الشيء الذي يكتب ولا يقرأ؟",
          answer: "القلم",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "rid-400-1",
          points: 400,
          question: "ما هو الشيء الذي كلما أخذتَ منه كَبُر، وكلما أضفتَ إليه صَغُر؟",
          answer: "الحفرة",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "rid-400-2",
          points: 400,
          question: "أكمل المثل العربي الشهير: «ربّ أخٍ لك ...»؟",
          answer: "لم تلده أمك",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "rid-600-1",
          points: 600,
          question: "ما هو الشيء الذي يحتوي على مدن بلا بيوت، وجبال بلا أشجار، وبحار بلا ماء؟",
          answer: "الخريطة",
          questionImage: "",
          answerImage: ""
        },
        {
          id: "rid-600-2",
          points: 600,
          question: "يُقال في المثل العربي القديم عند العودة دون فائدة: «رجع بخُفّي ...»؛ من هو صاحب الخفّين؟",
          answer: "حُنين («رجع بخُفّي حُنين»)",
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "visual-challenge",
      name: "تحدي الصور",
      icon: "🖼️",
      color: "#f43f5e",
      description: "تغبيش، تقريب، ظل، ألوان معكوسة، ذاكرة وفروقات",
      questions: [
        {
          id: "vis-200-1",
          points: 200,
          visualType: "blur",
          question: "تعرّف على المعلم السياحي العالمي الشهير خلف هذا التغبيش!",
          answer: "برج إيفل (باريس)",
          questionImage: "src/assets/visuals/eiffel-tower.svg",
          answerImage: ""
        },
        {
          id: "vis-200-2",
          points: 200,
          visualType: "silhouette",
          question: "من هذا الظل الأسود فقط.. ما هو الحيوان الظاهر في الصورة؟",
          answer: "الفيل",
          questionImage: "src/assets/visuals/elephant-silhouette.svg",
          answerImage: ""
        },
        {
          id: "vis-400-1",
          points: 400,
          visualType: "invert",
          question: "تم عكس ألوان هذا العلم بالكامل.. لأي دولة عربية يعود هذا العلم؟",
          answer: "علم المملكة الأردنية الهاشمية",
          questionImage: "src/assets/visuals/jordan-flag.svg",
          answerImage: ""
        },
        {
          id: "vis-400-2",
          points: 400,
          visualType: "zoom",
          zoomOrigin: "52% 62%",
          question: "من هذه اللقطة المُقرّبة جداً.. ما هي الفاكهة الموجودة في الصورة؟",
          answer: "البطيخ",
          questionImage: "src/assets/visuals/watermelon-zoom.svg",
          answerImage: ""
        },
        {
          id: "vis-600-1",
          points: 600,
          visualType: "memory",
          memorySeconds: 10,
          question: "اختبار الذاكرة: كم عدد الكتب الموجودة على الرف العلوي، وما لون الكوب على المكتب؟",
          answer: "3 كتب على الرف (أزرق، أخضر، أصفر)، ولون الكوب أحمر",
          questionImage: "src/assets/visuals/memory-desk.svg",
          answerImage: ""
        },
        {
          id: "vis-600-2",
          points: 600,
          visualType: "spot-diff",
          differencesCount: 3,
          question: "دقّق في الصورتين جيداً.. اذكر الفروقات الـ 3 بين الصورة (أ) والصورة (ب)!",
          answer: "1) وجود طائر في السماء (أ) واختفاؤه في (ب) • 2) لون باب المنزل أحمر (أ) وأزرق (ب) • 3) وجود قطة برتقالية تحت الشجرة (أ) واختفاؤها في (ب)",
          images: [
            "src/assets/visuals/spot-diff-a.svg",
            "src/assets/visuals/spot-diff-b.svg"
          ],
          questionImage: "",
          answerImage: "src/assets/visuals/spot-diff-answer.svg"
        }
      ]
    },
    {
      id: "multi-image-connect",
      name: "اربط الصور",
      icon: "🔗",
      color: "#a855f7",
      description: "ادمج معاني الصور أو اكتشف الرابط المشترك بينها",
      questions: [
        {
          id: "mul-200-1",
          points: 200,
          visualType: "multi-image",
          showPlus: true,
          hint: "كائن بحري شهير يتكوّن اسمه من دمج الصورتين",
          question: "ادمج الصورتين معاً: ما هو الاسم الناتج؟",
          answer: "نجم البحر",
          explanation: "الصورة (1) «نجم» + الصورة (2) «البحر» = «نجم البحر».",
          images: [
            "images/multi-image/q1-1.svg",
            "images/multi-image/q1-2.svg"
          ],
          questionImage: "",
          answerImage: ""
        },
        {
          id: "mul-200-2",
          points: 200,
          visualType: "multi-image",
          showPlus: true,
          hint: "أداة قديمة لقياس الوقت يتكوّن اسمها من كلمتين",
          question: "ادمج الصورتين معاً: ما هي الأداة المقصودة؟",
          answer: "الساعة الرملية",
          explanation: "الصورة (1) «ساعة» + الصورة (2) «رمال» = «الساعة الرملية».",
          images: [
            "images/multi-image/q2-1.svg",
            "images/multi-image/q2-2.svg"
          ],
          questionImage: "",
          answerImage: ""
        },
        {
          id: "mul-400-1",
          points: 400,
          visualType: "multi-image",
          showPlus: true,
          hint: "مثل عربي شهير يجمع بين الطائر واليد والشجرة",
          question: "اربط الصور الثلاث لاكتشاف المثل العربي الشهير!",
          answer: "عصفور باليد خير من عشرة على الشجرة",
          explanation: "الصورة (1) «عصفور» + الصورة (2) «اليد» + الصورة (3) «الشجرة» ← المثل العربي: عصفور باليد خير من عشرة على الشجرة.",
          images: [
            "images/multi-image/q3-1.svg",
            "images/multi-image/q3-2.svg",
            "images/multi-image/q3-3.svg"
          ],
          questionImage: "",
          answerImage: ""
        },
        {
          id: "mul-400-2",
          points: 400,
          visualType: "multi-image",
          showPlus: false,
          hint: "مشروب وتقليد ضيافة عربي أصيل",
          question: "ما الرابط المشترك الذي تجمع بينه هذه الصور الثلاث؟",
          answer: "القهوة العربية",
          explanation: "الصور الثلاث تمثل رموز الضيافة العربية: (1) حبوب البن، (2) الدلّة الذهبية، (3) الفنجان العربي.",
          images: [
            "images/multi-image/q4-1.svg",
            "images/multi-image/q4-2.svg",
            "images/multi-image/q4-3.svg"
          ],
          questionImage: "",
          answerImage: ""
        },
        {
          id: "mul-600-1",
          points: 600,
          visualType: "multi-image",
          showPlus: false,
          hint: "ظاهرة طبيعية سنوية تتكرر في أربع مراحل",
          question: "4 صور ورابط واحد مشترك.. ما الذي تجمعه هذه الصور الأربع؟",
          answer: "الفصول الأربعة (الربيع، الصيف، الخريف، الشتاء)",
          explanation: "كل صورة تمثل فصلاً من فصول السنة: (1) الربيع بالزهور، (2) الصيف بالشمس والبحر، (3) الخريف بالأوراق المتساقطة، (4) الشتاء بالثلج.",
          images: [
            "images/multi-image/q5-1.svg",
            "images/multi-image/q5-2.svg",
            "images/multi-image/q5-3.svg",
            "images/multi-image/q5-4.svg"
          ],
          questionImage: "",
          answerImage: ""
        },
        {
          id: "mul-600-2",
          points: 600,
          visualType: "multi-image",
          showPlus: false,
          hint: "حدث رياضي عالمي ضخم يُقام كل 4 سنوات",
          question: "4 صور ورابط واحد مشترك.. ما هو الحدث العالمي المقصود؟",
          answer: "الألعاب الأولمبية (الأولمبياد)",
          explanation: "الصور الأربع تمثل أبرز رموز الأولمبياد: (1) الشعلة الأولمبية، (2) الحلقات الخمس، (3) الميدالية الذهبية، (4) منصة التتويج.",
          images: [
            "images/multi-image/q6-1.svg",
            "images/multi-image/q6-2.svg",
            "images/multi-image/q6-3.svg",
            "images/multi-image/q6-4.svg"
          ],
          questionImage: "",
          answerImage: ""
        }
      ]
    },
    {
      id: "blur-images",
      name: "صورة مغبشة",
      icon: "🌫️",
      color: "#0ea5e9",
      description: "تعرّف على المعلم أو الشكل خلف التغبيش مع خيار التلميح",
      questions: [
        {
          id: "blur-200-1",
          points: 200,
          visualType: "blur",
          blurLevel: 18,
          question: "تعرّف على هذا المعلم الإسلامي المقدس الظاهر خلف التغبيش!",
          answer: "الكعبة المشرفة (المسجد الحرام)",
          questionImage: "images/blur/q1-kaaba.svg",
          answerImage: ""
        },
        {
          id: "blur-200-2",
          points: 200,
          visualType: "blur",
          question: "ما هو الحيوان البري الشهير الظاهر في هذه الصورة المغبشة؟",
          answer: "الزرافة",
          questionImage: "images/blur/q2-giraffe.svg",
          answerImage: ""
        },
        {
          id: "blur-400-1",
          points: 400,
          visualType: "blur",
          blurLevel: 18,
          question: "ما اسم هذا المعلم التاريخي العربي العريق خلف التغبيش؟",
          answer: "أهرامات الجيزة (مصر)",
          questionImage: "images/blur/q3-pyramids.svg",
          answerImage: ""
        },
        {
          id: "blur-400-2",
          points: 400,
          visualType: "blur",
          blurLevel: 16,
          question: "ما هي الفاكهة الظاهرة في هذه الصورة المغبشة؟",
          answer: "الفراولة",
          questionImage: "images/blur/q4-strawberry.svg",
          answerImage: ""
        },
        {
          id: "blur-600-1",
          points: 600,
          visualType: "blur",
          blurLevel: 20,
          question: "تعرّف على هذا المعلم الأثري الأوروبي الشهير خلف التغبيش!",
          answer: "مدرج الكولوسيوم (روما - إيطاليا)",
          questionImage: "images/blur/q5-colosseum.svg",
          answerImage: ""
        },
        {
          id: "blur-600-2",
          points: 600,
          visualType: "blur",
          blurLevel: 22,
          question: "ما هو الطائر القطبي الظاهر خلف هذه الصورة المغبشة؟",
          answer: "البطريق",
          questionImage: "images/blur/q6-penguin.svg",
          answerImage: ""
        }
      ]
    },
    {
      id: "spot-the-difference",
      name: "أوجد الفرق",
      icon: "👀",
      color: "#f97316",
      description: "قارن بين الصورتين بدقة واكتشف جميع الفروقات المخفية",
      questions: [
        {
          id: "diff-200-1",
          points: 200,
          visualType: "spot-diff",
          differencesCount: 3,
          question: "مشهد الشاطئ والمنارة: قارن بين الصورتين واذكر جميع الفروقات!",
          answer: "1) سحابة بيضاء أعلى اليسار في (أ) ومختفية في (ب) • 2) لون شراع القارب أحمر في (أ) وأصفر في (ب) • 3) نجم بحر برتقالي على الرمل في (أ) ومختفٍ في (ب)",
          images: [
            "images/spot-diff/q1-a.svg",
            "images/spot-diff/q1-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q1-answer.svg"
        },
        {
          id: "diff-200-2",
          points: 200,
          visualType: "spot-diff",
          differencesCount: 3,
          question: "مشهد حديقة المنزل: دقّق في التفاصيل واكتشف الفروقات بين الصورتين!",
          answer: "1) طائر يطير في السماء أعلى اليمين في (أ) ومختفٍ في (ب) • 2) لون باب المنزل أحمر في (أ) وأزرق في (ب) • 3) قطة برتقالية تحت الشجرة في (أ) ومختفية في (ب)",
          images: [
            "images/spot-diff/q2-a.svg",
            "images/spot-diff/q2-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q2-answer.svg"
        },
        {
          id: "diff-400-1",
          points: 400,
          visualType: "spot-diff",
          differencesCount: 4,
          question: "مشهد الفضاء والقمر: أوجد الفروقات الأربعة بين الصورتين!",
          answer: "1) نجمة ذهبية كبيرة أعلى اليسار في (أ) ومختفية في (ب) • 2) لون كوكب زحل برتقالي في (أ) وبنفسجي في (ب) • 3) لون نافذة الصاروخ سماوي في (أ) وأصفر في (ب) • 4) عَلم أحمر على سطح القمر في (أ) ومختفٍ في (ب)",
          images: [
            "images/spot-diff/q3-a.svg",
            "images/spot-diff/q3-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q3-answer.svg"
        },
        {
          id: "diff-400-2",
          points: 400,
          visualType: "spot-diff",
          differencesCount: 4,
          question: "مشهد المقهى والشارع: قارن جيداً واذكر الفروقات الأربعة!",
          answer: "1) ساعة حائط فوق الباب في (أ) ومختفية في (ب) • 2) لون المظلة أحمر وأبيض في (أ) وأخضر وأبيض في (ب) • 3) فنجان قهوة على الطاولة في (أ) ومختفٍ في (ب) • 4) مصباح العمود مضيء بالأصفر في (أ) ومنطفئ رمادي في (ب)",
          images: [
            "images/spot-diff/q4-a.svg",
            "images/spot-diff/q4-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q4-answer.svg"
        },
        {
          id: "diff-600-1",
          points: 600,
          visualType: "spot-diff",
          differencesCount: 5,
          question: "مشهد الصحراء والواحة: تحدّي الدقة.. اكتشف الفروقات الخمسة!",
          answer: "1) هلال في السماء أعلى اليمين في (أ) ومختفٍ في (ب) • 2) لون الخيمة أحمر وذهبي في (أ) وأزرق وذهبي في (ب) • 3) نخلة ثانية يسار البركة في (أ) ومختفية في (ب) • 4) جرة فخارية بجانب الخيمة في (أ) ومختفية في (ب) • 5) سمكة برتقالية في البركة في (أ) ومختفية في (ب)",
          images: [
            "images/spot-diff/q5-a.svg",
            "images/spot-diff/q5-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q5-answer.svg"
        },
        {
          id: "diff-600-2",
          points: 600,
          visualType: "spot-diff",
          differencesCount: 5,
          question: "مشهد غرفة الدراسة: تحدّي الدقة.. أوجد الفروقات الخمسة بين الصورتين!",
          answer: "1) عقرب الساعة يشير للثالثة في (أ) والتاسعة في (ب) • 2) الكتاب الأصفر على الرف موجود في (أ) ومختفٍ في (ب) • 3) لون المصباح أصفر في (أ) وسماوي في (ب) • 4) كرة أرضية صغيرة على المكتب في (أ) ومختفية في (ب) • 5) لون الكوب أحمر في (أ) وأخضر في (ب)",
          images: [
            "images/spot-diff/q6-a.svg",
            "images/spot-diff/q6-b.svg"
          ],
          questionImage: "",
          answerImage: "images/spot-diff/q6-answer.svg"
        }
      ]
    },
    {
      id: "extreme-zoom",
      name: "زوم شديد",
      icon: "🔎",
      color: "#06b6d4",
      description: "تعرّف على الشيء من تفصيل مُقرّب جداً مع تلميح تخفيف الزوم",
      questions: [
        {
          id: "zoom-200-1",
          points: 200,
          visualType: "zoom",
          zoomLevel: 3.8,
          zoomOrigin: "50% 48%",
          question: "من هذه اللقطة المُقرّبة جداً.. ما هو الشيء الظاهر في الصورة؟",
          answer: "كرة القدم",
          questionImage: "images/zoom/q1.svg",
          answerImage: ""
        },
        {
          id: "zoom-200-2",
          points: 200,
          visualType: "zoom",
          zoomOrigin: "50% 56%",
          question: "تعرّف على هذه الأكلة الشهيرة من خلال هذا الزوم الشديد!",
          answer: "شريحة بيتزا بالبيبروني",
          questionImage: "images/zoom/q2.svg",
          answerImage: ""
        },
        {
          id: "zoom-400-1",
          points: 400,
          visualType: "zoom",
          zoomLevel: 4.0,
          zoomOrigin: "50% 50%",
          question: "دقّق في هذا الجزء المُقرّب.. ما هو الشيء الكامل في الصورة؟",
          answer: "ساعة يد كلاسيكية",
          questionImage: "images/zoom/q3.svg",
          answerImage: ""
        },
        {
          id: "zoom-400-2",
          points: 400,
          visualType: "zoom",
          zoomLevel: 4.0,
          zoomOrigin: "52% 53%",
          question: "من هذه العدسة المُقرّبة جداً.. ما هو الجهاز الظاهر في الصورة؟",
          answer: "كاميرا تصوير احترافية",
          questionImage: "images/zoom/q4.svg",
          answerImage: ""
        },
        {
          id: "zoom-600-1",
          points: 600,
          visualType: "zoom",
          zoomLevel: 4.2,
          zoomOrigin: "38% 44%",
          question: "زوم شديد على تفاصيل ملوّنة.. ما هو الكائن الحي الظاهر في الصورة؟",
          answer: "فراشة ملكية ملوّنة",
          questionImage: "images/zoom/q5.svg",
          answerImage: ""
        },
        {
          id: "zoom-600-2",
          points: 600,
          visualType: "zoom",
          zoomLevel: 4.4,
          zoomOrigin: "51% 50%",
          question: "من هذا التفصيل الخشبي والأوتار.. ما هي الآلة الموسيقية في الصورة؟",
          answer: "غيتار خشبي كلاسيكي",
          questionImage: "images/zoom/q6.svg",
          answerImage: ""
        }
      ]
    },
    {
      id: "memory-images",
      name: "ذاكرة الصورة",
      icon: "🧠",
      color: "#8b5cf6",
      description: "تأمّل الصورة لثوانٍ معدودة ثم أجب عن تفاصيلها من الذاكرة",
      questions: [
        {
          id: "mem-200-1",
          points: 200,
          visualType: "memory",
          memorySeconds: 10,
          question: "كم عدد التفاحات الحمراء في السلة، وما لون إبريق الماء على الطاولة؟",
          answer: "4 تفاحات حمراء، ولون إبريق الماء أزرق",
          questionImage: "images/memory/q1.svg",
          answerImage: ""
        },
        {
          id: "mem-200-2",
          points: 200,
          visualType: "memory",
          question: "ما هو الرقم المكتوب على حافلة المدرسة، وما لون إشارة المرور المضيئة؟",
          answer: "الرقم 27، ولون إشارة المرور المضيئة أخضر",
          questionImage: "images/memory/q2.svg",
          answerImage: ""
        },
        {
          id: "mem-400-1",
          points: 400,
          visualType: "memory",
          memorySeconds: 10,
          question: "كم كانت الساعة على الحائط، وما لون الأريكة الموجودة في الغرفة؟",
          answer: "الساعة الرابعة تماماً (4:00)، ولون الأريكة أخضر",
          questionImage: "images/memory/q3.svg",
          answerImage: ""
        },
        {
          id: "mem-400-2",
          points: 400,
          visualType: "memory",
          memorySeconds: 12,
          question: "كم عدد البالونات في الصورة، وكم عدد صناديق الهدايا على الطاولة؟",
          answer: "5 بالونات، و3 صناديق هدايا",
          questionImage: "images/memory/q4.svg",
          answerImage: ""
        },
        {
          id: "mem-600-1",
          points: 600,
          visualType: "memory",
          memorySeconds: 12,
          question: "ما الرقم الظاهر على التقويم، كم كتاباً باللون الأحمر على الرف، وما لون القطة؟",
          answer: "الرقم 15 على التقويم، كتاب واحد باللون الأحمر، والقطة لونها أسود",
          questionImage: "images/memory/q5.svg",
          answerImage: ""
        },
        {
          id: "mem-600-2",
          points: 600,
          visualType: "memory",
          memorySeconds: 12,
          question: "كم عدد القوارب الشراعية في البحر، كم عدد الطيور في السماء، وما الرقم المكتوب على المنارة؟",
          answer: "3 قوارب شراعية، 4 طيور في السماء، والرقم المكتوب على المنارة هو 9",
          questionImage: "images/memory/q6.svg",
          answerImage: ""
        }
      ]
    },
    {
      id: "bank-jordan",
      name: "الأردن ومعالمه",
      icon: "🇯🇴",
      color: "#dc2626",
      description: "أسئلة حول جغرافية الأردن ومعالمه وتاريخه",
      questions: [
        {
          id: "bank-jo-200-1",
          points: 200,
          visualType: "normal",
          question: "ما هي المدينة الأردنية الملقبة بـ «المدينة الوردية»؟",
          answer: "البتراء",
          questionImage: "",
          answerImage: "",
          hint: "تقع في محافظة معان وتُعد من عجائب الدنيا السبع الجديدة",
          explanation: "سُميت بالمدينة الوردية نسبة إلى لون الصخور الرملية الوردية التي نُحتت فيها."
        },
        {
          id: "bank-jo-200-2",
          points: 200,
          visualType: "normal",
          question: "ما هي أخفض نقطة على سطح اليابسة في العالم وتقع على الحدود الغربية للأردن؟",
          answer: "البحر الميت",
          questionImage: "",
          answerImage: "",
          hint: "يمتاز بنسبة ملوحة عالية جداً",
          explanation: "ينخفض سطح البحر الميت بأكثر من 400 متر تحت مستوى سطح البحر."
        },
        {
          id: "bank-jo-400-1",
          points: 400,
          visualType: "normal",
          question: "في أي عام نالت المملكة الأردنية الهاشمية استقلالها؟",
          answer: "1946 (25 أيار 1946)",
          questionImage: "",
          answerImage: "",
          hint: "في أربعينيات القرن العشرين بعد نهاية الحرب العالمية الثانية بسنة واحدة",
          explanation: "أُعلن استقلال المملكة في 25 أيار عام 1946م."
        },
        {
          id: "bank-jo-400-2",
          points: 400,
          visualType: "normal",
          question: "ما هو الاسم التاريخي القديم لمدينة جرش الأثرية في العصر الروماني؟",
          answer: "جراسا (Gerasa)",
          questionImage: "",
          answerImage: "",
          hint: "اسم لاتيني قريب جداً من الاسم الحالي",
          explanation: "كانت جراسا إحدى مدن حلف الديكابولس العشر الشهيرة."
        },
        {
          id: "bank-jo-600-1",
          points: 600,
          visualType: "normal",
          question: "ما هي أعلى قمة جبلية في الأردن؟",
          answer: "جبل أم الدامي",
          questionImage: "",
          answerImage: "",
          hint: "تقع في أقصى جنوب الأردن بالقرب من وادي رم",
          explanation: "يبلغ ارتفاع قمة جبل أم الدامي 1854 متراً فوق مستوى سطح البحر."
        },
        {
          id: "bank-jo-600-2",
          points: 600,
          visualType: "normal",
          question: "ما هو النهر الذي يشكّل جزءاً من الحدود الشمالية للأردن ويصب في نهر الأردن؟",
          answer: "نهر اليرموك",
          questionImage: "",
          answerImage: "",
          hint: "يحمل اسم معركة إسلامية تاريخية شهيرة",
          explanation: "يُعد نهر اليرموك أكبر روافد نهر الأردن."
        },
        {
          id: "bank-jo-200-3",
          points: 200,
          visualType: "normal",
          question: "ما هو الميناء البحري الوحيد للمملكة الأردنية الهاشمية؟",
          answer: "ميناء العقبة",
          questionImage: "",
          answerImage: "",
          hint: "يقع في أقصى جنوب المملكة على البحر الأحمر",
          explanation: "تُطل مدينة العقبة على خليج العقبة المتفرع من البحر الأحمر."
        },
        {
          id: "bank-jo-400-3",
          points: 400,
          visualType: "normal",
          question: "أين تقع قلعة عجلون التاريخية التي بناها عز الدين أسامة؟",
          answer: "على جبل عوف في محافظة عجلون",
          questionImage: "",
          answerImage: "",
          hint: "بُنيت في عهد صلاح الدين الأيوبي شمال الأردن",
          explanation: "شُيّدت القلعة عام 1184م لحماية طرق المواصلات ومناجم الحديد."
        },
        {
          id: "bank-jo-600-3",
          points: 600,
          visualType: "normal",
          question: "ما اسم القصر الصحراوي الأموي في الأردن المُدرج على قائمة التراث العالمي لليونسكو؟",
          answer: "قُصير عمرة",
          questionImage: "",
          answerImage: "",
          hint: "يشتهر بلوحاته الجدارية الفريدة وقبته الفلكية في البادية الشرقية",
          explanation: "بُني قصير عمرة في أوائل القرن الثامن الميلادي في البادية الأردنية."
        }
      ]
    },
    {
      id: "bank-islamic",
      name: "ثقافة إسلامية",
      icon: "🕌",
      color: "#10b981",
      description: "أسئلة في القرآن الكريم والسيرة والتاريخ الإسلامي",
      questions: [
        {
          id: "bank-isl-200-1",
          points: 200,
          visualType: "normal",
          question: "ما هي أطول سورة في القرآن الكريم؟",
          answer: "سورة البقرة",
          questionImage: "",
          answerImage: "",
          hint: "تقع في بداية المصحف بعد سورة الفاتحة",
          explanation: "يبلغ عدد آيات سورة البقرة 286 آية."
        },
        {
          id: "bank-isl-200-2",
          points: 200,
          visualType: "normal",
          question: "من هو أول الخلفاء الراشدين؟",
          answer: "أبو بكر الصديق رضي الله عنه",
          questionImage: "",
          answerImage: "",
          hint: "رافق النبي صلى الله عليه وسلم في الهجرة إلى المدينة",
          explanation: "تولى الخلافة عام 11 هـ بعد وفاة النبي صلى الله عليه وسلم."
        },
        {
          id: "bank-isl-400-1",
          points: 400,
          visualType: "normal",
          question: "ما هي السورة الوحيدة التي لا تبدأ بالبسملة في القرآن الكريم؟",
          answer: "سورة التوبة",
          questionImage: "",
          answerImage: "",
          hint: "تقع في الجزء العاشر والحادي عشر وتُعرف أيضاً بسورة براءة",
          explanation: "تبدأ مباشرة بقوله تعالى: «براءة من الله ورسوله»."
        },
        {
          id: "bank-isl-400-2",
          points: 400,
          visualType: "normal",
          question: "في أي سنة هجرية وقعت غزوة بدر الكبرى؟",
          answer: "السنة الثانية للهجرة (2 هـ)",
          questionImage: "",
          answerImage: "",
          hint: "وقعت في السابع عشر من شهر رمضان",
          explanation: "تُعد أول معركة كبرى فاصلة في التاريخ الإسلامي."
        },
        {
          id: "bank-isl-600-1",
          points: 600,
          visualType: "normal",
          question: "من هو الصحابي الوحيد الذي ذُكر اسمه صراحةً في القرآن الكريم؟",
          answer: "زيد بن حارثة رضي الله عنه",
          questionImage: "",
          answerImage: "",
          hint: "ورد اسمه في سورة الأحزاب",
          explanation: "ذُكر اسمه في الآية 37 من سورة الأحزاب."
        },
        {
          id: "bank-isl-600-2",
          points: 600,
          visualType: "normal",
          question: "ما هي السورة القرآنية التي وردت فيها البسملة مرتين؟",
          answer: "سورة النمل",
          questionImage: "",
          answerImage: "",
          hint: "تحمل اسم حشرة معروفة بالنظام",
          explanation: "وردت مرة في بداية السورة، والمرة الثانية في رسالة النبي سليمان عليه السلام (الآية 30)."
        }
      ]
    },
    {
      id: "bank-cars",
      name: "عالم السيارات",
      icon: "🚗",
      color: "#f59e0b",
      description: "أسئلة حول شركات السيارات، الشعارات، والأنظمة الميكانيكية",
      questions: [
        {
          id: "bank-car-200-1",
          points: 200,
          visualType: "normal",
          question: "ما هي الدولة التي تأسست فيها شركة سيارات «تويوتا» (Toyota)؟",
          answer: "اليابان",
          questionImage: "",
          answerImage: "",
          hint: "دولة آسيوية رائدة في صناعة السيارات",
          explanation: "تأسست شركة تويوتا موتور عام 1937 في اليابان."
        },
        {
          id: "bank-car-200-2",
          points: 200,
          visualType: "normal",
          question: "كم عدد الحلقات المتداخلة في شعار شركة «أودي» (Audi)؟",
          answer: "4 حلقات",
          questionImage: "",
          answerImage: "",
          hint: "ترمز لعدد الشركات الأربع التي اندمجت لتكوين اتحاد Auto Union",
          explanation: "تمثل الحلقات الأربع اندماج شركات Audi وDKW وHorch وWanderer عام 1932."
        },
        {
          id: "bank-car-400-1",
          points: 400,
          visualType: "normal",
          question: "ما هو الحيوان الموجود على شعار شركة «فيراري» (Ferrari)؟",
          answer: "الحصان (الحصان الجامح)",
          questionImage: "",
          answerImage: "",
          hint: "يرمز للسرعة والقوة ويكون باللون الأسود على خلفية صفراء",
          explanation: "يُعرف بشعار الحصان الجامح (Cavallino Rampante)."
        },
        {
          id: "bank-car-400-2",
          points: 400,
          visualType: "normal",
          question: "في أي دولة أوروبية يقع المقر الرئيسي لشركة «فولفو» (Volvo) للسيارات؟",
          answer: "السويد",
          questionImage: "",
          answerImage: "",
          hint: "دولة إسكندنافية اشتهرت بمعايير الأمان العالية في سياراتها",
          explanation: "تأسست فولفو في مدينة غوتنبرغ السويدية عام 1927."
        },
        {
          id: "bank-car-600-1",
          points: 600,
          visualType: "normal",
          question: "ماذا يختصر مصطلح «ABS» في أنظمة أمان السيارات؟",
          answer: "نظام منع انغلاق المكابح (Anti-lock Braking System)",
          questionImage: "",
          answerImage: "",
          hint: "نظام يمنع قفل العجلات أثناء الفرملة المفاجئة للحفاظ على التوجيه",
          explanation: "يساعد نظام ABS السائق على الحفاظ على السيطرة والتوجيه أثناء التوقف الطارئ."
        },
        {
          id: "bank-car-600-2",
          points: 600,
          visualType: "normal",
          question: "ما هي المجموعة الألمانية المالكة لعلامتي «بنتلي» و«لامبورغيني»؟",
          answer: "مجموعة فولكس فاجن (Volkswagen Group)",
          questionImage: "",
          answerImage: "",
          hint: "تملك أيضاً علامات أودي وبورش وسكودا",
          explanation: "تُعد مجموعة فولكس فاجن من أكبر تكتلات صناعة السيارات في العالم."
        }
      ]
    },
    {
      id: "bank-medical",
      name: "طب وصحة",
      icon: "🩺",
      color: "#0ea5e9",
      description: "أسئلة حول جسم الإنسان والعلوم الطبية الأساسية",
      questions: [
        {
          id: "bank-med-200-1",
          points: 200,
          visualType: "normal",
          question: "ما هو العضو المسؤول عن ضخ الدم إلى جميع أنحاء جسم الإنسان؟",
          answer: "القلب",
          questionImage: "",
          answerImage: "",
          hint: "عضلة تعمل بلا توقف طوال حياة الإنسان",
          explanation: "يضخ القلب الدم المحمل بالأكسجين عبر الشرايين إلى كافة أنسجة الجسم."
        },
        {
          id: "bank-med-200-2",
          points: 200,
          visualType: "normal",
          question: "ما هو المعدن الأساسي المسؤول عن نقل الأكسجين في الهيموغلوبين داخل خلايا الدم الحمراء؟",
          answer: "الحديد",
          questionImage: "",
          answerImage: "",
          hint: "نقصه هو السبب الأكثر شيوعاً لفقر الدم",
          explanation: "يرتبط الأكسجين بذرات الحديد الموجودة في بروتين الهيموغلوبين."
        },
        {
          id: "bank-med-400-1",
          points: 400,
          visualType: "normal",
          question: "كم عدد العظام في جسم الإنسان البالغ؟",
          answer: "206 عظمات",
          questionImage: "",
          answerImage: "",
          hint: "أقل من عدد عظام الطفل حديث الولادة بسبب التحام بعض العظام مع النمو",
          explanation: "يولد الإنسان بحوالي 270 عظمة تلتحم تدريجياً لتصبح 206 عظمات عند البلوغ."
        },
        {
          id: "bank-med-400-2",
          points: 400,
          visualType: "normal",
          question: "ما هو الهرمون الذي يفرزه البنكرياس لخفض مستوى السكر في الدم؟",
          answer: "الإنسولين",
          questionImage: "",
          answerImage: "",
          hint: "تُفرزه خلايا بيتا في جزر لانغرهانس",
          explanation: "يساعد الإنسولين خلايا الجسم على امتصاص الجلوكوز من الدم لاستخدامه كطاقة."
        },
        {
          id: "bank-med-600-1",
          points: 600,
          visualType: "normal",
          question: "ما هي أطول وأقوى عظمة في جسم الإنسان؟",
          answer: "عظمة الفخذ (Femur)",
          questionImage: "",
          answerImage: "",
          hint: "تقع في الطرف السفلي بين الحوض والركبة",
          explanation: "تتحمل عظمة الفخذ وزن الجسم أثناء المشي والركض والقفز."
        },
        {
          id: "bank-med-600-2",
          points: 600,
          visualType: "normal",
          question: "ما اسم العالم الاسكتلندي الذي اكتشف البنسلين عام 1928؟",
          answer: "ألكسندر فليمنغ (Alexander Fleming)",
          questionImage: "",
          answerImage: "",
          hint: "كان اكتشافه بداية عصر المضادات الحيوية الحديثة",
          explanation: "حصل فليمنغ على جائزة نوبل في الطب عام 1945 عن اكتشاف البنسلين."
        }
      ]
    },
    {
      id: "mgk-general",
      name: "من غير كلام: عام",
      icon: "🎭",
      color: "#6366f1",
      group: "charades",
      description: "تمثيل صامت لأشياء وأماكن ومفاهيم متنوعة",
      questions: [
        {
          id: "local-mgk-gen-200-1",
          categoryId: "mgk-general",
          points: 200,
          visualType: "normal",
          question: "🎭 من غير كلام — أجهزة يومية (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "فرشاة أسنان",
          hint: "أداة عناية شخصية نستخدمها صباحاً ومساءً أمام المرآة",
          explanation: "مثّل وضع المعجون على الفرشاة ثم تفريش الأسنان والمضمضة بالماء."
        },
        {
          id: "local-mgk-gen-200-2",
          categoryId: "mgk-general",
          points: 200,
          visualType: "normal",
          question: "🎭 من غير كلام — أدوات مطبخ (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "غلاية ماء",
          hint: "جهاز كهربائي سريع لتحضير الشاي والقهوة في دقائق",
          explanation: "مثّل تعبئة الإبريق بالماء، وضعه على القاعدة والضغط على الزر، ثم انتظار البخار والصب في كوب."
        },
        {
          id: "local-mgk-gen-200-3",
          categoryId: "mgk-general",
          points: 200,
          visualType: "normal",
          question: "🎭 من غير كلام — أنشطة خارجية (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "طائرة ورقية",
          hint: "لعبة تطير عالياً في الهواء مربوطة بخيط طويل",
          explanation: "مثّل الركض عكس الريح مع الإمساك ببكرة خيط وشدّها للأعلى والنظر للسماء."
        },
        {
          id: "local-mgk-gen-400-1",
          categoryId: "mgk-general",
          points: 400,
          visualType: "normal",
          question: "🎭 من غير كلام — مرافق وسفر (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "بوابة التفتيش",
          hint: "نمرّ عبرها في المطارات والمولات وتصدر رنيناً عند وجود معادن",
          explanation: "مثّل إفراغ الجيوب في سلة، المرور عبر إطار باب، سماع إنذار مفاجئ، ثم تفتيش رجل الأمن لك."
        },
        {
          id: "local-mgk-gen-400-2",
          categoryId: "mgk-general",
          points: 400,
          visualType: "normal",
          question: "🎭 من غير كلام — مواقف عامة (3 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "انقطاع التيار الكهربائي",
          hint: "حدث مفاجئ يجعل المكان مظلماً فنبحث فوراً عن كشاف الهاتف",
          explanation: "مثّل مشاهدة التلفاز ثم فجأة ينطفئ كل شيء، تتحسس طريقك في الظلام وتشعل فلاش الهاتف أو شمعة."
        },
        {
          id: "local-mgk-gen-400-3",
          categoryId: "mgk-general",
          points: 400,
          visualType: "normal",
          question: "🎭 من غير كلام — أماكن ترفيه (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "قطار الموت",
          hint: "لعبة مثيرة وسريعة جداً في مدينة الملاهي",
          explanation: "مثّل إغلاق حاجز الأمان على الكتفين، الصعود البطيء المتوتر، ثم الهبوط السريع ورفع اليدين بالصراخ الصامت."
        },
        {
          id: "local-mgk-gen-600-1",
          categoryId: "mgk-general",
          points: 600,
          visualType: "normal",
          question: "🎭 من غير كلام — ظاهرة طبيعية (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "كسوف الشمس",
          hint: "ظاهرة فلكية نادرة يحجب فيها القمر ضوء النهار مؤقتاً",
          explanation: "مثّل النظر للسماء بنظارات واقية خاصة، وتحرك قرص أمام الشمس فيحل الظلام تدريجياً لبضع لحظات."
        },
        {
          id: "local-mgk-gen-600-2",
          categoryId: "mgk-general",
          points: 600,
          visualType: "normal",
          question: "🎭 من غير كلام — مفهوم تقني (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "الواقع الافتراضي",
          hint: "تقنية تجعلك داخل عالم ثلاثي الأبعاد عبر نظارة خاصة على العينين",
          explanation: "مثّل ارتداء نظارة كبيرة تغطي العينين، ثم الالتفات يميناً ويساراً بدهشة والتفاعل بيديك مع أشياء غير مرئية بالهواء."
        },
        {
          id: "local-mgk-gen-600-3",
          categoryId: "mgk-general",
          points: 600,
          visualType: "normal",
          question: "🎭 من غير كلام — استكشاف ومغامرة (3 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الكلمة سراً.",
          answer: "البحث عن الكنز",
          hint: "رحلة تعتمد على خريطة قديمة وبوصلة وحفر للوصول إلى صندوق ثمين",
          explanation: "مثّل فتح خريطة كبيرة وتتبع الخطوات، الحفر بالمجرفة، ثم إخراج صندوق ثقيل وفتحه بانبهار."
        }
      ]
    },
    {
      id: "mgk-movies",
      name: "من غير كلام: أفلام",
      icon: "🎬",
      color: "#e11d48",
      group: "charades",
      description: "تمثيل صامت لأسماء أفلام عربية وعالمية شهيرة",
      questions: [
        {
          id: "local-mgk-mov-200-1",
          categoryId: "mgk-movies",
          points: 200,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم أنيميشن عالمي (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "الأسد الملك",
          hint: "فيلم رسوم متحركة كلاسيكي من ديزني تدور قصته في غابات أفريقيا",
          explanation: "مثّل زئير أسد قوي ووضع تاج فوق الرأس، ثم رفع شبل صغير عالياً فوق صخرة أمام الجميع."
        },
        {
          id: "local-mgk-mov-200-2",
          categoryId: "mgk-movies",
          points: 200,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم عالمي شهير (كلمة واحدة) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "تايتانيك",
          hint: "فيلم درامي تاريخي شهير عن سفينة عملاقة تصطدم بجبل جليدي",
          explanation: "مثّل الوقوف في مقدمة سفينة وفرد الذراعين في الهواء، ثم اصطدام عنيف وميلان السفينة والبرد الشديد."
        },
        {
          id: "local-mgk-mov-200-3",
          categoryId: "mgk-movies",
          points: 200,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم كوميدي مصري (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "غبي منه فيه",
          hint: "فيلم كوميدي شهير لهاني رمزي وحسن حسني عن لص متعثر دائماً",
          explanation: "مثّل التسلل كلص بطريقة مضحكة ومتعثرة، ثم الإشارة للرأس للدلالة على قلة الحيلة."
        },
        {
          id: "local-mgk-mov-400-1",
          categoryId: "mgk-movies",
          points: 400,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم أنيميشن (3 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "البحث عن نيمو",
          hint: "فيلم رسوم متحركة تدور أحداثه تحت أعماق المحيط بحثاً عن سمكة صغيرة مفقودة",
          explanation: "مثّل السباحة كسمكة صغيرة بزعنفة قصيرة، ثم تلفت الأب يميناً ويساراً بالمنظار للبحث عنها في البحر."
        },
        {
          id: "local-mgk-mov-400-2",
          categoryId: "mgk-movies",
          points: 400,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم أكشن عالمي (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "مهمة مستحيلة",
          hint: "سلسلة أفلام جاسوسية شهيرة لتوم كروز تتضمن الهبوط بحبل من السقف",
          explanation: "مثّل التدلي بحبل من سقف الغرفة بتوازن أفقي دقيق دون لمس الأرض لسرقة ملف سري."
        },
        {
          id: "local-mgk-mov-400-3",
          categoryId: "mgk-movies",
          points: 400,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم مصري (3 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "الفيل الأزرق",
          hint: "فيلم غموض وإثارة نفسي لكريم عبد العزيز مقتبس من رواية شهيرة",
          explanation: "قسّم الاسم: مثّل خرطوم وأذني الفيل الكبيرتين، ثم أشر إلى اللون الأزرق."
        },
        {
          id: "local-mgk-mov-600-1",
          categoryId: "mgk-movies",
          points: 600,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم خيال علمي (3 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "العودة إلى المستقبل",
          hint: "فيلم كلاسيكي عن سيارة تسافر عبر الزمن بسرعة 88 ميلاً في الساعة",
          explanation: "مثّل النظر لساعة اليد بدهشة، ركوب سيارة رياضية والانطلاق بسرعة خارقة ثم الإشارة للخلف ثم للأمام."
        },
        {
          id: "local-mgk-mov-600-2",
          categoryId: "mgk-movies",
          points: 600,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم مصري (4 كلمات) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "إسماعيلية رايح جاي",
          hint: "فيلم شهير لمحمد فؤاد ومحمد هنيدي يرتبط اسمه بمدينة مصرية على قناة السويس",
          explanation: "مثّل السفر بالقطار ذهاباً ثم العودة إياباً بحركة اليد «رايح جاي» مع غناء صامت بالمايكروفون."
        },
        {
          id: "local-mgk-mov-600-3",
          categoryId: "mgk-movies",
          points: 600,
          visualType: "normal",
          question: "🎬 من غير كلام — فيلم عالمي (كلمتان) | يُدير الفريق ظهره للشاشة، ويضغط الممثّل «إظهار الإجابة» لمعرفة الاسم سراً.",
          answer: "كوكب القردة",
          hint: "فيلم خيال علمي يهبط فيه رواد فضاء على عالم تسيطر عليه كائنات ذكية تشبه البشر",
          explanation: "مثّل رسم كرة أرضية كبيرة في الهواء، ثم تقليد مشية وحركات القرد الذكي الذي يقود جيشاً."
        }
      ]
    }
  ]
};

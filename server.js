const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5174);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const BRAZIL_SEED_VERSION = "br-2";
const INTERNATIONAL_SEED_VERSION = "intl-1";
const DEFAULT_CURRENCY = "BRL";
const INTERNATIONAL_CURRENCIES = ["USD", "INR", "EUR", "GBP"];

const PRODUCT_PROFILE = {
  name: "AMD Ryzen 7 5800X3D 10th Anniversary Edition",
  modelCode: "100-100000651POF",
  requiredSignals: ["ryzen", "5800x3d"],
  anniversarySignals: [
    "10th anniversary",
    "10th-anniversary",
    "anniversary edition",
    "10 anos",
    "edicao de 10 anos",
    "edicao aniversario",
    "edicao de aniversario",
    "edition 10",
    "carbice",
    "100-100000651pof"
  ],
  wrongProductPatterns: [
    /\b5700x3d\b/i,
    /\b7600x3d\b/i,
    /\b7700x3d\b/i,
    /\b7800x3d\b/i,
    /\b9700x3d\b/i,
    /\b9800x3d\b/i,
    /\b5900x\b/i,
    /\b5800xt\b/i,
    /\b5800x(?!3d)\b/i
  ]
};

const DEFAULT_STATE = {
  settings: {
    productName: PRODUCT_PROFILE.name,
    region: "BR",
    currency: DEFAULT_CURRENCY,
    seedVersion: BRAZIL_SEED_VERSION,
    internationalSeedVersion: INTERNATIONAL_SEED_VERSION,
    requireAnniversarySignals: true,
    intervalMinutes: 60,
    autoScan: true,
    webhookUrl: "",
    lastScanStartedAt: null,
    lastScanFinishedAt: null
  },
  sources: [
    {
      id: "kabum-5800x3d-pof",
      store: "KaBuM!",
      url: "https://www.kabum.com.br/produto/1053076/processador-amd-ryzen-7-5800x3d-3-4ghz-turbo-4-5ghz-96mb-cache-am4-100-100000651pof",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Pagina brasileira com codigo 100-100000651POF.",
      createdAt: new Date().toISOString()
    },
    {
      id: "pichau-5800x3d-busca",
      store: "Pichau",
      url: "https://www.pichau.com.br/search?q=Ryzen%207%205800X3D%20100-100000651POF",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Busca da loja; pode aparecer como bloqueada se a protecao anti-bot impedir leitura.",
      createdAt: new Date().toISOString()
    },
    {
      id: "terabyte-5800x3d-busca",
      store: "TerabyteShop",
      url: "https://www.terabyteshop.com.br/busca?str=Ryzen%207%205800X3D%20100-100000651POF",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Busca da loja; a pagina direta encontrada era do 5800X3D WOF comum, entao fica no modo rigido.",
      createdAt: new Date().toISOString()
    },
    {
      id: "gk-5800x3d-10th",
      store: "GK Info Store",
      url: "https://www.gkinfostore.com.br/processador-amd-ryzen-7-5800x3d-10th-anniversary-edition-34ghz-45ghz-octa-core-100mb-am4-100-100000651pof",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Pagina brasileira com titulo explicito da edicao 10th Anniversary.",
      createdAt: new Date().toISOString()
    },
    {
      id: "amazon-br-5800x3d-pof",
      store: "Amazon Brasil",
      url: "https://www.amazon.com.br/AMD-Processador-5800X3D-n%C3%BAcleos-tecnologia/dp/B0H41D4KFT",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Marketplace; validacao rigida evita confundir seguro, parcela ou produto relacionado com o processador.",
      createdAt: new Date().toISOString()
    },
    {
      id: "mercadolivre-5800x3d-pof",
      store: "Mercado Livre",
      url: "https://www.mercadolivre.com.br/procesador-amd-ryzen-7-5800x3d-34-ghz-8-nucleos-16-hilos-10/p/MLB2082057969",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Marketplace; pode pedir verificacao de conta e bloquear a leitura automatica.",
      createdAt: new Date().toISOString()
    },
    {
      id: "patoloco-5800x3d-busca",
      store: "Patoloco",
      url: "https://patoloco.com.br/busca?palavra=5800x3d",
      targetPrice: 2500,
      currency: DEFAULT_CURRENCY,
      active: true,
      notes: "Busca da loja; registra historico somente se a pagina confirmar o produto correto.",
      createdAt: new Date().toISOString()
    }
  ],
  internationalSources: [
    {
      id: "bestbuy-5800x3d-intl",
      store: "Best Buy EUA",
      url: "https://www.bestbuy.com/product/amd-ryzen-7-5800x3d-8-core-16-thread-3-4-ghz-4-5-ghz-max-boost-socket-am4-pci-express-4-0-unlocked-desktop-processor-black/JXKQHH5Y64",
      currency: "USD",
      active: true,
      notes: "Fonte internacional usada apenas para tendencia.",
      createdAt: new Date().toISOString()
    },
    {
      id: "99deals-5800x3d-intl",
      store: "99Deals India",
      url: "https://99deals.in/product/ryzen-7-5800x3d-am4-10th-anniversary-edition-the-processor/",
      currency: "INR",
      active: true,
      notes: "Fonte internacional usada apenas para tendencia.",
      createdAt: new Date().toISOString()
    }
  ],
  history: [],
  internationalHistory: [],
  alerts: [],
  events: []
};

let state = loadState();
let scanTimer = null;
let scanInProgress = false;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    saveState(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }

  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const migrated = migrateState(loaded);
    saveState(migrated);
    return migrated;
  } catch (error) {
    const fallback = structuredClone(DEFAULT_STATE);
    fallback.events.unshift({
      id: createId("evt"),
      type: "state_recovery",
      tone: "danger",
      message: `Nao consegui ler data/state.json; iniciei com dados padrao. ${error.message}`,
      createdAt: new Date().toISOString()
    });
    saveState(fallback);
    return fallback;
  }
}

function migrateState(loaded) {
  const settings = {
    ...DEFAULT_STATE.settings,
    ...(loaded.settings || {}),
    region: "BR",
    currency: DEFAULT_CURRENCY,
    seedVersion: BRAZIL_SEED_VERSION,
    internationalSeedVersion: INTERNATIONAL_SEED_VERSION
  };
  const rawSources = (Array.isArray(loaded.sources) ? loaded.sources : []).filter(
    (source) => source.id !== "powertec-5800x3d-10th"
  );
  const keptSources = rawSources.filter((source) => isBrazilianStoreUrl(source.url)).map(normalizeBrazilianSource);
  const movedInternationalSources = rawSources
    .filter((source) => !isBrazilianStoreUrl(source.url))
    .map(normalizeInternationalSource);
  const keptInternationalSources = Array.isArray(loaded.internationalSources)
    ? loaded.internationalSources.map(normalizeInternationalSource)
    : [];
  const shouldSeedBrazilSources = (loaded.settings || {}).seedVersion !== BRAZIL_SEED_VERSION;
  const shouldSeedInternationalSources =
    (loaded.settings || {}).internationalSeedVersion !== INTERNATIONAL_SEED_VERSION &&
    keptInternationalSources.length === 0 &&
    movedInternationalSources.length === 0;
  const sources = shouldSeedBrazilSources
    ? mergeSourcesByUrl([...structuredClone(DEFAULT_STATE.sources), ...keptSources])
    : keptSources;
  const internationalSources = shouldSeedInternationalSources
    ? structuredClone(DEFAULT_STATE.internationalSources)
    : mergeSourcesByUrl([...keptInternationalSources, ...movedInternationalSources]);
  const sourceIds = new Set(sources.map((source) => source.id));
  const internationalSourceIds = new Set(internationalSources.map((source) => source.id));
  const history = (Array.isArray(loaded.history) ? loaded.history : [])
    .filter((entry) => entry.currency === DEFAULT_CURRENCY && sourceIds.has(entry.sourceId))
    .filter((entry) => isReasonablePriceForCurrency(entry.price, entry.currency))
    .map((entry) => ({ ...entry, currency: DEFAULT_CURRENCY }));
  const movedInternationalHistory = (Array.isArray(loaded.history) ? loaded.history : [])
    .filter((entry) => entry.currency !== DEFAULT_CURRENCY || internationalSourceIds.has(entry.sourceId))
    .map((entry) => ({ ...entry, id: entry.id || createId("intl"), accepted: Boolean(entry.accepted) }));
  const internationalHistory = [
    ...(Array.isArray(loaded.internationalHistory) ? loaded.internationalHistory : []),
    ...movedInternationalHistory
  ]
    .filter((entry) => internationalSourceIds.has(entry.sourceId))
    .filter((entry) => isReasonablePriceForCurrency(entry.price, entry.currency))
    .slice(-1200);
  const alerts = (Array.isArray(loaded.alerts) ? loaded.alerts : [])
    .filter((alert) => alert.currency === DEFAULT_CURRENCY && sourceIds.has(alert.sourceId))
    .map((alert) => ({ ...alert, currency: DEFAULT_CURRENCY }));
  const events = Array.isArray(loaded.events) ? loaded.events : [];

  if (rawSources.length && rawSources.length !== keptSources.length) {
    events.unshift({
      id: createId("evt"),
      type: "br_sources_only",
      tone: "warning",
      message: "Fontes internacionais movidas para o bloco isolado de tendencia.",
      createdAt: new Date().toISOString()
    });
  }

  return {
    ...structuredClone(DEFAULT_STATE),
    ...loaded,
    settings,
    sources,
    internationalSources,
    history,
    internationalHistory,
    alerts,
    events: events.slice(0, 120)
  };
}

function saveState(nextState = state) {
  ensureDataDir();
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  fs.renameSync(tmpFile, STATE_FILE);
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function isBrazilianStoreUrl(value) {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    return hostname === "brasil" || hostname.endsWith(".br");
  } catch {
    return false;
  }
}

function normalizeBrazilianSource(source) {
  const lastPrice = isReasonablePriceForCurrency(source.lastPrice, DEFAULT_CURRENCY)
    ? Number(source.lastPrice)
    : null;
  return {
    ...source,
    targetPrice: Number(source.targetPrice || 0),
    currency: DEFAULT_CURRENCY,
    lastPrice,
    lastCurrency: DEFAULT_CURRENCY,
    active: source.active !== false
  };
}

function normalizeInternationalSource(source) {
  const currency = String(source.currency || guessInternationalCurrency(source.url)).toUpperCase();
  return {
    ...source,
    id: source.id || createId("intl_src"),
    store: source.store || safeHostname(source.url),
    targetPrice: undefined,
    currency: INTERNATIONAL_CURRENCIES.includes(currency) ? currency : guessInternationalCurrency(source.url),
    active: source.active !== false
  };
}

function guessInternationalCurrency(value) {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    if (hostname.endsWith(".in")) return "INR";
    if (hostname.endsWith(".uk") || hostname.endsWith(".co.uk")) return "GBP";
    if (hostname.endsWith(".de") || hostname.endsWith(".fr") || hostname.endsWith(".es")) return "EUR";
  } catch {
    // Fall back below.
  }
  return "USD";
}

function safeHostname(value) {
  try {
    return new URL(String(value || "")).hostname.replace(/^www\./, "");
  } catch {
    return "Fonte internacional";
  }
}

function mergeSourcesByUrl(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = String(source.url || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nowIso() {
  return new Date().toISOString();
}

function addEvent(type, tone, message, details = {}) {
  state.events.unshift({
    id: createId("evt"),
    type,
    tone,
    message,
    details,
    createdAt: nowIso()
  });
  state.events = state.events.slice(0, 120);
}

function addAlert(source, snapshot, reason) {
  const recentDuplicate = state.alerts.find((alert) => {
    const sameSource = alert.sourceId === source.id;
    const samePrice = Number(alert.price) === Number(snapshot.price);
    const ageMs = Date.now() - new Date(alert.createdAt).getTime();
    return sameSource && samePrice && ageMs < 1000 * 60 * 60 * 6;
  });

  if (recentDuplicate) {
    return null;
  }

  const alert = {
    id: createId("alert"),
    sourceId: source.id,
    store: source.store,
    url: source.url,
    price: snapshot.price,
    currency: DEFAULT_CURRENCY,
    targetPrice: source.targetPrice,
    stockStatus: snapshot.stockStatus,
    reason,
    createdAt: nowIso(),
    read: false
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 80);
  return alert;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`,
      "i"
    );
    const match = html.match(pattern);
    if (match) {
      return decodeHtml(match[1] || match[2] || "");
    }
  }
  return "";
}

function extractTagText(html, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(pattern);
  return match ? stripTags(match[1]) : "";
}

function parseLocalizedNumber(raw, preferredCurrency = "") {
  const cleaned = String(raw || "").replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const currency = preferredCurrency.toUpperCase();
  if (currency === "BRL") {
    const value = Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }

  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (commaIndex > -1 && dotIndex > -1) {
    normalized =
      commaIndex > dotIndex
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (commaIndex > -1) {
    const decimals = cleaned.length - commaIndex - 1;
    normalized = decimals === 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function detectCurrency(text, fallback = DEFAULT_CURRENCY, allowedCurrencies = [DEFAULT_CURRENCY]) {
  const value = String(text || "");
  const checks = [
    ["BRL", /r\$\s*|brl/i],
    ["USD", /us\$\s*|usd|\$\s*\d/i],
    ["INR", /₹|inr/i],
    ["EUR", /€|eur/i],
    ["GBP", /£|gbp/i]
  ];
  const match = checks.find(([currency, pattern]) => allowedCurrencies.includes(currency) && pattern.test(value));
  if (match) return match[0];
  return allowedCurrencies.includes(fallback) ? fallback : allowedCurrencies[0] || DEFAULT_CURRENCY;
}

function collectPricesFromText(text, fallbackCurrency, allowedCurrencies = [DEFAULT_CURRENCY]) {
  const candidates = [];
  const patterns = [
    { currency: "BRL", regex: /(?:r\$|brl)\s*([0-9][0-9.,]*)/gi },
    { currency: "USD", regex: /(?:us\$|usd)\s*([0-9][0-9.,]*)/gi },
    { currency: "INR", regex: /(?:₹|inr)\s*([0-9][0-9.,]*)/gi },
    { currency: "EUR", regex: /(?:€|eur)\s*([0-9][0-9.,]*)/gi },
    { currency: "GBP", regex: /(?:£|gbp)\s*([0-9][0-9.,]*)/gi },
    { currency: "USD", regex: /\$\s*([0-9][0-9.,]*)/gi }
  ].filter((pattern) => allowedCurrencies.includes(pattern.currency));

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const price = parseLocalizedNumber(match[1], pattern.currency);
      if (price && price > 10) {
        candidates.push({
          price,
          currency: pattern.currency,
          source: "texto"
        });
      }
    }
  }

  return candidates;
}

function collectJsonLd(html) {
  const scripts = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;

    try {
      scripts.push(JSON.parse(raw));
    } catch {
      const fixed = raw.replace(/,\s*([}\]])/g, "$1");
      try {
        scripts.push(JSON.parse(fixed));
      } catch {
        // Some stores ship invalid JSON-LD. The other extractors still cover them.
      }
    }
  }
  return scripts;
}

function walkJson(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visitor));
    return;
  }
  Object.values(value).forEach((item) => walkJson(item, visitor));
}

function collectStructuredData(html, fallbackCurrency) {
  const names = [];
  const prices = [];
  const availability = [];

  for (const block of collectJsonLd(html)) {
    walkJson(block, (node) => {
      if (typeof node.name === "string") names.push(node.name);
      if (typeof node.sku === "string") names.push(node.sku);
      if (typeof node.mpn === "string") names.push(node.mpn);
      if (typeof node.model === "string") names.push(node.model);
      if (node.availability) availability.push(String(node.availability));

      const priceValue = node.price || node.lowPrice || node.highPrice;
      if (priceValue) {
        const currency = String(node.priceCurrency || fallbackCurrency || "BRL").toUpperCase();
        const price = parseLocalizedNumber(priceValue, currency);
        if (price && price > 10) {
          prices.push({
            price,
            currency,
            source: "json-ld"
          });
        }
      }
    });
  }

  return { names, prices, availability };
}

function extractProductData(html, fallbackCurrency, pageUrl, allowedCurrencies = [DEFAULT_CURRENCY]) {
  const title = extractMeta(html, ["og:title", "twitter:title"]) || extractTagText(html, "title");
  const h1 = extractTagText(html, "h1");
  const description = extractMeta(html, ["og:description", "description", "twitter:description"]);
  const structured = collectStructuredData(html, fallbackCurrency);
  const productName = structured.names.find(Boolean) || h1 || title || pageUrl;
  const mainText = [productName, title, h1, description].filter(Boolean).join(" | ");
  const bodyText = stripTags(html).slice(0, 160000);
  const allText = `${mainText} ${bodyText}`;
  const primaryProductText = `${mainText} ${extractPrimaryProductText(bodyText)}`;

  const metaPrice = extractMeta(html, [
    "product:price:amount",
    "og:price:amount",
    "twitter:data1",
    "price",
    "sale_price"
  ]);
  const metaCurrency =
    extractMeta(html, ["product:price:currency", "og:price:currency", "priceCurrency"]) ||
    detectCurrency(metaPrice, fallbackCurrency, allowedCurrencies);
  const priceCandidates = [...structured.prices];

  if (metaPrice) {
    const price = parseLocalizedNumber(metaPrice, metaCurrency);
    if (price && price > 10) {
      priceCandidates.unshift({
        price,
        currency: metaCurrency.toUpperCase(),
        source: "meta"
      });
    }
  }

  priceCandidates.push(...collectPricesFromText(primaryProductText, fallbackCurrency, allowedCurrencies));

  const stockStatus = detectStockStatus(allText, structured.availability);
  const match = evaluateProductMatch(mainText, allText);
  const selectedPrice = selectBestPrice(priceCandidates, fallbackCurrency, allowedCurrencies);

  return {
    title: productName,
    pageTitle: title,
    price: selectedPrice?.price || null,
    currency: selectedPrice?.currency || fallbackCurrency,
    priceSource: selectedPrice?.source || "",
    stockStatus,
    match
  };
}

function extractPrimaryProductText(bodyText) {
  const normalized = normalizeText(bodyText);
  const delimiters = [
    "produtos relacionados",
    "produtos similares",
    "quem viu tambem",
    "quem viu, viu tambem",
    "recomendados",
    "compre junto",
    "related products",
    "similar products",
    "customers also"
  ];
  const indexes = delimiters
    .map((delimiter) => normalized.indexOf(delimiter))
    .filter((index) => index > 500);
  if (!indexes.length) return bodyText;
  return bodyText.slice(0, Math.min(...indexes));
}

function selectBestPrice(candidates, fallbackCurrency, allowedCurrencies = [DEFAULT_CURRENCY]) {
  const filtered = candidates
    .filter((candidate) => candidate.price && candidate.price > 10)
    .filter((candidate) => allowedCurrencies.includes(candidate.currency))
    .filter((candidate) => isReasonablePriceForCurrency(candidate.price, candidate.currency));

  if (!filtered.length) return null;

  const preferred = filtered.filter((candidate) => candidate.currency === fallbackCurrency);
  const ordered = (preferred.length ? preferred : filtered).sort((a, b) => {
    const priority = priceSourcePriority(a.source) - priceSourcePriority(b.source);
    if (priority) return priority;
    if (a.source === "texto" && b.source === "texto") {
      return priceOccurrenceCount(b, filtered) - priceOccurrenceCount(a, filtered) || a.price - b.price;
    }
    return a.price - b.price;
  });
  return ordered[0];
}

function priceSourcePriority(source) {
  if (source === "json-ld") return 0;
  if (source === "meta") return 1;
  return 2;
}

function priceOccurrenceCount(candidate, candidates) {
  return candidates.filter((item) => {
    return item.currency === candidate.currency && Math.abs(Number(item.price) - Number(candidate.price)) < 0.01;
  }).length;
}

function isReasonablePriceForCurrency(value, currency) {
  const price = Number(value);
  if (!Number.isFinite(price)) return false;
  if (currency === "BRL") return price >= 1700 && price < 100000;
  if (currency === "INR") return price >= 10000 && price < 2000000;
  return price >= 100 && price < 10000;
}

function detectStockStatus(allText, availabilityValues) {
  const text = normalizeText(`${availabilityValues.join(" ")} ${allText}`);
  if (
    /\b(outofstock|out of stock|sold out|unavailable|indisponivel|sem estoque|esgotado|em breve)\b/.test(text)
  ) {
    return "out_of_stock";
  }
  if (/\b(instock|in stock|available|em estoque|disponivel|1 in stock|estoque:\s*[1-9])\b/.test(text)) {
    return "in_stock";
  }
  if (/\b(pre order|pre-order|pre venda|pre-venda)\b/.test(text)) {
    return "preorder";
  }
  return "unknown";
}

function evaluateProductMatch(mainText, allText) {
  const normalizedMain = normalizeText(mainText);
  const normalizedAll = normalizeText(allText);
  const wrongInMain = PRODUCT_PROFILE.wrongProductPatterns.find((pattern) => pattern.test(mainText));
  const hasRequiredSignals = PRODUCT_PROFILE.requiredSignals.every((term) =>
    normalizedAll.includes(term)
  );
  const hasMainModel = /\b5800x3d\b/i.test(mainText) || normalizedMain.includes("5800x3d");
  const hasAnniversarySignal = PRODUCT_PROFILE.anniversarySignals.some((term) =>
    normalizedAll.includes(term)
  );

  let score = 0;
  const reasons = [];

  if (hasRequiredSignals) {
    score += 55;
    reasons.push("contém Ryzen 7 5800X3D");
  }
  if (hasMainModel) {
    score += 20;
    reasons.push("modelo principal é 5800X3D");
  }
  if (hasAnniversarySignal) {
    score += 25;
    reasons.push("há sinal da edição de 10 anos");
  }
  if (wrongInMain) {
    score = Math.min(score, 25);
    reasons.push(`titulo parece ser outro produto (${wrongInMain.source})`);
  }

  const status = wrongInMain
    ? "wrong_product"
    : hasRequiredSignals && hasMainModel && hasAnniversarySignal
      ? "confirmed_anniversary"
      : hasRequiredSignals && hasMainModel
        ? "base_model_unconfirmed"
        : "not_matched";

  return {
    ok: status === "confirmed_anniversary" || status === "base_model_unconfirmed",
    strictOk: status === "confirmed_anniversary",
    status,
    confidence: Math.min(score, 100),
    reasons
  };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
      }
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      body
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("timeout ao carregar a pagina");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanSource(source) {
  const startedAt = nowIso();
  const snapshotBase = {
    id: createId("hist"),
    sourceId: source.id,
    store: source.store,
    url: source.url,
    checkedAt: startedAt,
    price: null,
    currency: DEFAULT_CURRENCY,
    stockStatus: "unknown",
    title: "",
    matchStatus: "not_checked",
    matchConfidence: 0,
    accepted: false,
    error: ""
  };

  try {
    const fetched = await fetchPage(source.url);
    if (!fetched.ok) {
      throw new Error(`HTTP ${fetched.status}`);
    }

    const data = extractProductData(fetched.body, DEFAULT_CURRENCY, fetched.finalUrl);
    const requireStrict = state.settings.requireAnniversarySignals !== false;
    const accepted = requireStrict ? data.match.strictOk : data.match.ok;
    const snapshot = {
      ...snapshotBase,
      title: data.title,
      price: data.price,
      currency: DEFAULT_CURRENCY,
      stockStatus: data.stockStatus,
      matchStatus: data.match.status,
      matchConfidence: data.match.confidence,
      matchReasons: data.match.reasons,
      priceSource: data.priceSource,
      accepted
    };

    source.lastCheckedAt = startedAt;
    source.lastStatus = accepted ? "ok" : data.match.status;
    source.lastTitle = data.title;
    source.lastPrice = accepted ? data.price : source.lastPrice || null;
    source.lastCurrency = DEFAULT_CURRENCY;
    source.lastStockStatus = data.stockStatus;
    source.lastError = "";
    source.lastMatchConfidence = data.match.confidence;

    if (!accepted) {
      addEvent(
        "mismatch",
        "warning",
        `${source.store}: pagina ignorada porque nao confirmou a edicao correta.`,
        {
          sourceId: source.id,
          title: data.title,
          matchStatus: data.match.status,
          reasons: data.match.reasons
        }
      );
      return snapshot;
    }

    if (!data.price) {
      source.lastStatus = "no_price";
      source.lastPrice = null;
      addEvent("no_price", "warning", `${source.store}: produto correto, mas nao encontrei preco.`, {
        sourceId: source.id,
        title: data.title
      });
      return snapshot;
    }

    state.history.push(snapshot);
    state.history = state.history.slice(-2500);

    const target = Number(source.targetPrice || 0);
    if (target > 0 && data.price <= target && data.stockStatus !== "out_of_stock") {
      const alert = addAlert(
        source,
        snapshot,
        `Preco ${formatCurrency(data.price, DEFAULT_CURRENCY)} ficou no alvo ${formatCurrency(
          target,
          DEFAULT_CURRENCY
        )}.`
      );
      if (alert) {
        addEvent("price_alert", "success", `${source.store}: preco dentro do alvo.`, {
          sourceId: source.id,
          alertId: alert.id
        });
        sendWebhook(alert).catch((error) => {
          addEvent("webhook_failed", "danger", `Webhook falhou: ${error.message}`, {
            alertId: alert.id
          });
          saveState();
        });
      }
    }

    return snapshot;
  } catch (error) {
    source.lastCheckedAt = startedAt;
    source.lastStatus = "error";
    source.lastError = error.message;
    addEvent("scan_error", "danger", `${source.store}: falha ao verificar (${error.message}).`, {
      sourceId: source.id
    });
    return {
      ...snapshotBase,
      error: error.message,
      matchStatus: "error"
    };
  }
}

async function scanInternationalSource(source) {
  const startedAt = nowIso();
  const sourceCurrency = INTERNATIONAL_CURRENCIES.includes(source.currency) ? source.currency : "USD";
  const snapshotBase = {
    id: createId("intl"),
    sourceId: source.id,
    store: source.store,
    url: source.url,
    checkedAt: startedAt,
    price: null,
    currency: sourceCurrency,
    stockStatus: "unknown",
    title: "",
    matchStatus: "not_checked",
    matchConfidence: 0,
    accepted: false,
    error: ""
  };

  try {
    const fetched = await fetchPage(source.url);
    if (!fetched.ok) {
      throw new Error(`HTTP ${fetched.status}`);
    }

    const data = extractProductData(fetched.body, sourceCurrency, fetched.finalUrl, [sourceCurrency]);
    const accepted = state.settings.requireAnniversarySignals !== false ? data.match.strictOk : data.match.ok;
    const snapshot = {
      ...snapshotBase,
      title: data.title,
      price: data.price,
      currency: data.currency || sourceCurrency,
      stockStatus: data.stockStatus,
      matchStatus: data.match.status,
      matchConfidence: data.match.confidence,
      matchReasons: data.match.reasons,
      priceSource: data.priceSource,
      accepted
    };

    source.lastCheckedAt = startedAt;
    source.lastStatus = accepted ? "ok" : data.match.status;
    source.lastTitle = data.title;
    source.lastPrice = accepted ? data.price : source.lastPrice || null;
    source.lastCurrency = data.currency || sourceCurrency;
    source.lastStockStatus = data.stockStatus;
    source.lastError = "";
    source.lastMatchConfidence = data.match.confidence;

    if (accepted && !data.price) {
      source.lastStatus = "no_price";
      source.lastPrice = null;
    }

    if (accepted && data.price) {
      state.internationalHistory.push(snapshot);
      state.internationalHistory = state.internationalHistory.slice(-1200);
    }

    return snapshot;
  } catch (error) {
    source.lastCheckedAt = startedAt;
    source.lastStatus = "error";
    source.lastError = error.message;
    addEvent("international_scan_error", "warning", `${source.store}: contexto internacional falhou (${error.message}).`, {
      sourceId: source.id
    });
    return {
      ...snapshotBase,
      error: error.message,
      matchStatus: "error"
    };
  }
}

async function scanAllSources({ onlySourceId = "" } = {}) {
  if (scanInProgress) {
    return {
      skipped: true,
      message: "Ja existe uma verificacao em andamento."
    };
  }

  scanInProgress = true;
  state.settings.lastScanStartedAt = nowIso();
  const sources = state.sources.filter((source) => {
    if (onlySourceId) return source.id === onlySourceId;
    return source.active !== false;
  });
  const internationalSources = onlySourceId
    ? []
    : state.internationalSources.filter((source) => source.active !== false);
  const results = [];
  const internationalResults = [];

  try {
    for (const source of sources) {
      results.push(await scanSource(source));
    }
    for (const source of internationalSources) {
      internationalResults.push(await scanInternationalSource(source));
    }
    state.settings.lastScanFinishedAt = nowIso();
    addEvent(
      "scan_finished",
      "neutral",
      onlySourceId
        ? "Verificacao manual da fonte concluida."
        : `Verificacao concluida em ${sources.length} fonte(s) brasileiras e ${internationalSources.length} internacional(is).`
    );
    return { skipped: false, results, internationalResults };
  } finally {
    scanInProgress = false;
    saveState();
  }
}

async function sendWebhook(alert) {
  const webhookUrl = state.settings.webhookUrl;
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      product: state.settings.productName,
      store: alert.store,
      price: alert.price,
      currency: alert.currency,
      targetPrice: alert.targetPrice,
      stockStatus: alert.stockStatus,
      url: alert.url,
      createdAt: alert.createdAt
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function formatCurrency(value, currency) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
      maximumFractionDigits: 2
    }).format(Number(value));
  } catch {
    return `${currency || ""} ${value}`;
  }
}

function sanitizeSource(input, existing = {}) {
  const url = String(input.url ?? existing.url ?? "").trim();
  if (!url) throw createHttpError(400, "Informe a URL da loja.");
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createHttpError(400, "A URL precisa comecar com http:// ou https://.");
  }
  if (!isBrazilianStoreUrl(parsed.toString())) {
    throw createHttpError(400, "Use apenas URLs de lojas brasileiras, normalmente terminadas em .br.");
  }

  return {
    ...existing,
    store: String(input.store ?? existing.store ?? parsed.hostname.replace(/^www\./, "")).trim(),
    url: parsed.toString(),
    targetPrice: Number(input.targetPrice ?? existing.targetPrice ?? 0),
    currency: DEFAULT_CURRENCY,
    active: Boolean(input.active ?? existing.active ?? true),
    notes: String(input.notes ?? existing.notes ?? "").trim()
  };
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const safePath = path
    .normalize(requestedPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nao encontrado");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png"
    }[ext] || "application/octet-stream";

  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw createHttpError(400, "JSON invalido.");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, {
      ...state,
      productProfile: PRODUCT_PROFILE,
      scanInProgress
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const body = await readJsonBody(req);
    state.settings = {
      ...state.settings,
      productName: String(body.productName ?? state.settings.productName).trim() || PRODUCT_PROFILE.name,
      region: "BR",
      currency: DEFAULT_CURRENCY,
      seedVersion: BRAZIL_SEED_VERSION,
      requireAnniversarySignals: Boolean(body.requireAnniversarySignals),
      intervalMinutes: Math.max(5, Number(body.intervalMinutes || state.settings.intervalMinutes || 60)),
      autoScan: Boolean(body.autoScan),
      webhookUrl: String(body.webhookUrl ?? "").trim()
    };
    scheduleScanner();
    saveState();
    sendJson(res, 200, state.settings);
    return;
  }

  if (req.method === "POST" && pathname === "/api/sources") {
    const body = await readJsonBody(req);
    const source = {
      id: createId("src"),
      ...sanitizeSource(body),
      createdAt: nowIso()
    };
    state.sources.unshift(source);
    addEvent("source_added", "neutral", `${source.store}: fonte adicionada.`);
    saveState();
    sendJson(res, 201, source);
    return;
  }

  const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && req.method === "PATCH") {
    const source = state.sources.find((item) => item.id === sourceMatch[1]);
    if (!source) throw createHttpError(404, "Fonte nao encontrada.");
    const body = await readJsonBody(req);
    Object.assign(source, sanitizeSource(body, source), { updatedAt: nowIso() });
    saveState();
    sendJson(res, 200, source);
    return;
  }

  if (sourceMatch && req.method === "DELETE") {
    const before = state.sources.length;
    state.sources = state.sources.filter((item) => item.id !== sourceMatch[1]);
    if (state.sources.length === before) throw createHttpError(404, "Fonte nao encontrada.");
    addEvent("source_removed", "neutral", "Fonte removida.");
    saveState();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/scan") {
    const result = await scanAllSources();
    sendJson(res, 200, result);
    return;
  }

  const scanMatch = pathname.match(/^\/api\/sources\/([^/]+)\/scan$/);
  if (scanMatch && req.method === "POST") {
    const result = await scanAllSources({ onlySourceId: scanMatch[1] });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && pathname === "/api/alerts/read") {
    state.alerts.forEach((alert) => {
      alert.read = true;
    });
    saveState();
    sendJson(res, 200, { ok: true });
    return;
  }

  throw createHttpError(404, "Rota nao encontrada.");
}

async function handleRequest(req, res) {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    sendStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Erro interno"
    });
  }
}

function scheduleScanner() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  if (!state.settings.autoScan) return;

  const intervalMs = Math.max(5, Number(state.settings.intervalMinutes || 60)) * 60 * 1000;
  scanTimer = setInterval(() => {
    scanAllSources().catch((error) => {
      addEvent("scan_error", "danger", `Falha geral na verificacao: ${error.message}`);
      saveState();
    });
  }, intervalMs);
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  scheduleScanner();
  console.log(`Monitor de precos rodando em http://localhost:${PORT}`);
  if (state.settings.autoScan && !state.settings.lastScanStartedAt) {
    setTimeout(() => {
      scanAllSources().catch((error) => {
        addEvent("scan_error", "danger", `Falha geral na verificacao inicial: ${error.message}`);
        saveState();
      });
    }, 1500);
  }
});

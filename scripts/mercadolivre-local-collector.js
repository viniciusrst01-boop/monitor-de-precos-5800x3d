const path = require("node:path");
const readline = require("node:readline/promises");

const DEFAULT_URL =
  "https://www.mercadolivre.com.br/amd-ryzen-7-5800x3d-anniversary-8c-16ths-34ghz-am4-preto/up/MLBU4234950727#polycard_client=search-desktop&be_origin=backend&search_layout=grid&position=1&type=product&tracking_id=31f978c9-0aa3-40db-965b-089b094e970c&wid=MLB4861423743&sid=search";

const sourceId = process.env.MERCADO_LIVRE_SOURCE_ID || "mercadolivre-5800x3d-pof";
const productUrl = process.env.MERCADO_LIVRE_URL || DEFAULT_URL;
const ingestUrl = process.env.MONITOR_INGEST_URL || "https://monitor-de-precos-5800x3d.onrender.com/api/manual-price";
const ingestToken = process.env.MONITOR_INGEST_TOKEN || "";
const profileDir = process.env.MERCADO_LIVRE_PROFILE_DIR || path.join(__dirname, "..", ".collector-profile", "mercadolivre");
const headless = process.env.MERCADO_LIVRE_HEADLESS === "1";

main().catch((error) => {
  console.error(`Coletor Mercado Livre falhou: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!ingestToken) {
    throw new Error("Defina MONITOR_INGEST_TOKEN antes de rodar o coletor.");
  }

  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    locale: "pt-BR",
    viewport: { width: 1366, height: 820 }
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    if (await looksBlocked(page)) {
      await waitForManualVerification(page);
    }

    const reading = await readProduct(page);
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${ingestToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sourceId,
        url: page.url(),
        title: reading.title,
        price: reading.price,
        currency: "BRL",
        stockStatus: reading.stockStatus,
        priceSource: "local-browser"
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status} ao enviar leitura`);
    }

    console.log(`Mercado Livre: ${formatBRL(reading.price)} enviado para o monitor.`);
  } finally {
    await context.close();
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright nao esta instalado. Rode: npm install --no-save playwright");
  }
}

async function looksBlocked(page) {
  const url = page.url();
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  return /account-verification|suspicious|verifica/i.test(url) || /verifica|validar|captcha|sou humano/i.test(text);
}

async function waitForManualVerification(page) {
  console.log("O Mercado Livre pediu verificacao. Resolva no navegador aberto e pressione Enter aqui.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("");
  rl.close();
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function readProduct(page) {
  const data = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || "";
    const title =
      text("h1") ||
      text(".ui-pdp-title") ||
      attr('meta[property="og:title"]', "content") ||
      document.title ||
      "";
    const metaPrice =
      attr('meta[itemprop="price"]', "content") ||
      attr('meta[property="product:price:amount"]', "content") ||
      attr('meta[property="og:price:amount"]', "content");
    const priceTexts = [
      metaPrice,
      ...Array.from(document.querySelectorAll(".andes-money-amount, .price-tag, [aria-label*='reais']")).map(
        (node) => node.textContent || node.getAttribute("aria-label") || ""
      )
    ].filter(Boolean);
    const body = document.body?.innerText || "";
    return { title, priceTexts, body };
  });

  const price = data.priceTexts.map(parseBRPrice).find((value) => Number.isFinite(value) && value > 0);
  if (!price) {
    throw new Error("Nao encontrei preco visivel na pagina do Mercado Livre.");
  }

  return {
    title: data.title,
    price,
    stockStatus: stockStatusFromText(data.body)
  };
}

function parseBRPrice(value) {
  const raw = String(value || "");
  const money = raw.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/);
  if (!money) return null;
  const integer = money[1].replace(/\./g, "");
  const cents = money[2] || "00";
  const parsed = Number(`${integer}.${cents}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function stockStatusFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/sem estoque|indisponivel|anuncio pausado|produto pausado/.test(text)) return "out_of_stock";
  if (/pre-venda|pre venda/.test(text)) return "preorder";
  if (/comprar agora|adicionar ao carrinho|estoque disponivel|disponivel/.test(text)) return "in_stock";
  return "unknown";
}

function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

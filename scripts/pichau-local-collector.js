const path = require("node:path");
const readline = require("node:readline/promises");

const DEFAULT_URL =
  "https://www.pichau.com.br/processador-amd-ryzen-7-5800x3d-8-core-16-threads-3-4ghz-4-5ghz-turbo-cache-100mb-am4-100-100000651pof";

const sourceId = process.env.PICHAU_SOURCE_ID || "pichau-5800x3d-busca";
const productUrl = process.env.PICHAU_URL || DEFAULT_URL;
const ingestUrl = process.env.MONITOR_INGEST_URL || "https://monitor-de-precos-5800x3d.onrender.com/api/manual-price";
const ingestToken = process.env.MONITOR_INGEST_TOKEN || "";
const profileDir = process.env.PICHAU_PROFILE_DIR || path.join(__dirname, "..", ".collector-profile", "pichau");
const headless = process.env.PICHAU_HEADLESS === "1";

main().catch((error) => {
  console.error(`Coletor Pichau falhou: ${error.message}`);
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
    await page.waitForTimeout(2000);

    let reading;
    try {
      reading = await readProduct(page);
    } catch {
      console.log("Nao encontrei o preco automaticamente. Deixe o produto e o preco a vista visiveis e pressione Enter aqui.");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await rl.question("");
      rl.close();
      reading = await readProduct(page);
    }

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
        priceSource: "local-browser-pix"
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status} ao enviar leitura`);
    }

    console.log(`Pichau: ${formatBRL(reading.price)} a vista enviado para o monitor.`);
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

async function readProduct(page) {
  const data = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    const title = text("h1") || document.title || "";
    const pixPriceTexts = Array.from(
      document.querySelectorAll('[class*="price_vista"], [class*="price-vista"], [class*="pix"]')
    ).map((node) => node.textContent || "");
    const mainText = document.querySelector("main")?.innerText || document.body?.innerText || "";
    const beforeInstallments = mainText.split(/parcelamento/i)[0];
    const labelledPixPrice = beforeInstallments.match(
      /(?:a vista|a vista|\u00e0 vista)[\s\S]{0,80}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i
    )?.[1];
    return {
      title,
      priceTexts: [...pixPriceTexts, labelledPixPrice].filter(Boolean),
      mainText
    };
  });

  const price = data.priceTexts
    .map(parseBRPrice)
    .find((value) => Number.isFinite(value) && value >= 1700 && value < 100000);
  if (!price) {
    throw new Error("Nao encontrei o preco a vista na pagina da Pichau.");
  }
  if (!/5800x3d/i.test(data.title) || !/100-100000651pof/i.test(`${data.title} ${data.mainText}`)) {
    throw new Error("A pagina aberta nao confirmou o Ryzen 7 5800X3D de codigo 100-100000651POF.");
  }

  return {
    title: data.title,
    price,
    stockStatus: stockStatusFromText(data.mainText)
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
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/sem estoque|indisponivel|esgotado/.test(text)) return "out_of_stock";
  if (/pre-venda|pre venda/.test(text)) return "preorder";
  if (/produto disponivel|comprar|colocar no carrinho/.test(text)) return "in_stock";
  return "unknown";
}

function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

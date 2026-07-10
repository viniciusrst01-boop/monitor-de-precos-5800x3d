const path = require("node:path");
const https = require("node:https");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const readline = require("node:readline/promises");

const execFileAsync = promisify(execFile);

const DEFAULT_URL =
  "https://www.pichau.com.br/processador-amd-ryzen-7-5800x3d-8-core-16-threads-3-4ghz-4-5ghz-turbo-cache-100mb-am4-100-100000651pof";

const sourceId = process.env.PICHAU_SOURCE_ID || "pichau-5800x3d-busca";
const productUrl = process.env.PICHAU_URL || DEFAULT_URL;
const ingestUrl = process.env.MONITOR_INGEST_URL || "https://monitor-de-precos-5800x3d.onrender.com/api/manual-price";
const ingestToken = process.env.MONITOR_INGEST_TOKEN || "";
const profileDir = process.env.PICHAU_PROFILE_DIR || path.join(__dirname, "..", ".collector-profile", "pichau");
const headless = process.env.PICHAU_HEADLESS === "1";
const assisted = process.env.PICHAU_ASSISTED !== "0";

main().catch((error) => {
  console.error(`Coletor Pichau falhou: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!ingestToken) {
    throw new Error("Defina MONITOR_INGEST_TOKEN antes de rodar o coletor.");
  }

  const httpReading = await readProductWithHttps(productUrl).catch(() => null);
  if (httpReading) {
    await submitReading(httpReading, productUrl, "local-http-pix");
    return;
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
    await page
      .waitForSelector('[class*="price_vista"], [class*="price-vista"], [class*="pix"]', {
        state: "attached",
        timeout: 25000
      })
      .catch(() => {});
    await page.waitForTimeout(1000);

    let reading;
    try {
      reading = await readProduct(page);
    } catch (error) {
      if (!assisted) throw error;
      console.log("Nao encontrei o preco automaticamente. Deixe o produto e o preco a vista visiveis e pressione Enter aqui.");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await rl.question("");
      rl.close();
      reading = await readProduct(page);
    }

    await submitReading(reading, page.url(), "local-browser-pix");
  } finally {
    await context.close();
  }
}

async function submitReading(reading, url, priceSource) {
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${ingestToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sourceId,
      url,
      title: reading.title,
      price: reading.price,
      currency: "BRL",
      stockStatus: reading.stockStatus,
      priceSource
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status} ao enviar leitura`);
  }

  console.log(`Pichau: ${formatBRL(reading.price)} a vista enviado para o monitor.`);
}

async function readProductWithHttps(url) {
  const html = await fetchHtmlWithCurl(url).catch(() => fetchHtml(url));
  if (!/5800x3d/i.test(html) || !/100-100000651pof/i.test(html)) {
    throw new Error("A resposta HTTP nao confirmou o produto correto.");
  }

  const metaPrice = html.match(/product:price:amount\\?"\s+content=\\?"([^"\\]+)/i)?.[1];
  const avistaPrice = html.match(/\\?"avista_price\\?"\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];
  const price = parseBRPrice(metaPrice || avistaPrice);
  if (!price || price < 1700 || price >= 100000) {
    throw new Error("Nao encontrei o preco a vista na resposta HTTP da Pichau.");
  }

  return {
    title: "Processador AMD Ryzen 7 5800X3D 100-100000651POF",
    price,
    stockStatus: /schema\.org\\?\/InStock|produto disponivel/i.test(html) ? "in_stock" : "unknown"
  };
}

async function fetchHtmlWithCurl(url) {
  const curlCommand = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    curlCommand,
    [
      "-L",
      "--max-time",
      "25",
      "--silent",
      "--show-error",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "--header",
      "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8",
      url
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 30000 }
  );
  return stdout;
}

function fetchHtml(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
        }
      },
      (response) => {
        const status = Number(response.statusCode || 0);
        if (status >= 300 && status < 400 && response.headers.location && redirectCount < 4) {
          response.resume();
          fetchHtml(new URL(response.headers.location, url).toString(), redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) request.destroy(new Error("pagina maior que 2 MB"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    request.setTimeout(25000, () => request.destroy(new Error("timeout ao carregar a Pichau")));
    request.on("error", reject);
  });
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
      /(?:a vista|\u00e0 vista)[\s\S]{0,80}?(R\$\s*\d[\d.,]*\d)/i
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
  const money = raw.match(/(?:R\$\s*)?(\d[\d.,]*)/);
  if (!money) return null;
  const token = money[1];
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  const hasDecimalCents = decimalIndex >= 0 && token.length - decimalIndex - 1 === 2;
  const normalized = hasDecimalCents
    ? `${token.slice(0, decimalIndex).replace(/[.,]/g, "")}.${token.slice(decimalIndex + 1)}`
    : token.replace(/[.,]/g, "");
  const parsed = Number(normalized);
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

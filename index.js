import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// 🔥 HARD FAIL-SAFE IMAGE PROXY
app.get("/image-proxy", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000); // 🔥 2 SECOND HARD STOP

  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "image/*,*/*;q=0.8"
      }
    });

    clearTimeout(timeout);

    if (!upstream.ok) throw new Error("bad image");

    const buffer = await upstream.arrayBuffer();

    res.set({
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg"
    });

    return res.send(Buffer.from(buffer));

  } catch (err) {
    clearTimeout(timeout);

    // 🔥 ALWAYS RETURN SOMETHING (never hang)
    res.set({ "Content-Type": "image/png" });

    return res.send(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64"
    ));
  }
});

async function launchBrowser() {
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: chromium.headless
  });
}

async function addPageNumbers(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const text = `J&H Fixall | Confidential Property Report | Page ${i + 1} of ${totalPages}`;
    const size = 8;
    const textWidth = font.widthOfTextAtSize(text, size);

    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 12,
      size,
      font,
      color: rgb(0.4, 0.4, 0.4)
    });
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function buildPdf(html, headerTemplate, footerTemplate, options = {}) {
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // 🔥 FETCH HTML (no ERR_ABORTED)
    let htmlContent = html;

    if (options.html_url) {
      const response = await fetch(options.html_url);

      if (!response.ok) {
        throw new Error("HTML fetch failed");
      }

      htmlContent = await response.text();
    }

    await page.setContent(htmlContent, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 🔥 CRITICAL: DO NOT WAIT FOR IMAGES
    await page.waitForTimeout(3000);

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,

      headerTemplate:
        headerTemplate ||
        `<div style="font-size:8px; width:100%; text-align:center;">
          Guardian Living Home Record
        </div>`,

      footerTemplate: `<div></div>`,

      margin: {
        top: "20mm",
        right: "8mm",
        bottom: "20mm",
        left: "8mm"
      }
    });

    return await addPageNumbers(pdf);

  } finally {
    if (browser) await browser.close();
  }
}

app.post("/generate-pdf", async (req, res) => {
  try {
    const { html, html_url, headerTemplate, footerTemplate } = req.body || {};

    const pdf = await buildPdf(html, headerTemplate, footerTemplate, {
      html_url
    });

    res.set({
      "Content-Type": "application/pdf"
    });

    return res.send(pdf);

  } catch (err) {
    console.error("PDF FAILED:", err);
    return res.status(500).json({ error: "PDF generation failed" });
  }
});

app.listen(PORT, () => {
  console.log("running");
});

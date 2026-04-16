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

// 🔥 HARDENED IMAGE PROXY (never hangs)
app.get("/image-proxy", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    console.log("IMAGE:", url);

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
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=31536000"
    });

    return res.send(Buffer.from(buffer));

  } catch (err) {
    clearTimeout(timeout);
    console.warn("IMAGE FAIL:", req.query.url);

    // fallback 1x1 image
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

    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(60000);

    // 🔥 ALWAYS FETCH HTML (fixes ERR_ABORTED)
    let htmlContent = html;

    if (options.html_url) {
      console.log("FETCH HTML:", options.html_url);

      const response = await fetch(options.html_url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "text/html"
        }
      });

      if (!response.ok) {
        throw new Error("HTML fetch failed");
      }

      htmlContent = await response.text();
    }

    await page.setContent(htmlContent, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 🔥 FIX: replace unsupported waitForTimeout
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,

      headerTemplate:
        headerTemplate ||
        `
        <div style="width:100%; font-size:8px; color:#6b7280; padding:0 10mm;">
          <div style="display:flex; justify-content:space-between;">
            <div>Property Address Not Available</div>
            <div>Guardian Living Home Record</div>
            <div>Prepared for: Client</div>
          </div>
        </div>
        `,

      footerTemplate: footerTemplate || `<div></div>`,

      margin: {
        top: "20mm",
        right: "8mm",
        bottom: "20mm",
        left: "8mm"
      }
    });

    return await addPageNumbers(pdf);

  } catch (err) {
    console.error("PDF BUILD ERROR:", err);
    throw err;

  } finally {
    if (browser) await browser.close();
  }
}

app.post("/generate-pdf", async (req, res) => {
  try {
    const { html, html_url, headerTemplate, footerTemplate } = req.body || {};

    if ((!html || typeof html !== "string") && !html_url) {
      return res.status(400).json({ error: "Missing html or html_url payload" });
    }

    const pdf = await buildPdf(html, headerTemplate, footerTemplate, {
      html_url
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="inspection-report.pdf"',
      "Cache-Control": "no-store"
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

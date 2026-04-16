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

//
// 🔥 IMAGE PROXY (THIS IS THE FIX)
//
app.get("/image-proxy", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send("Missing url");
    }

    const response = await fetch(url);

    if (!response.ok) {
      console.error("IMAGE FETCH FAILED:", url);
      return res.status(500).send("Failed to fetch image");
    }

    const buffer = await response.arrayBuffer();

    res.set({
      "Content-Type": response.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=31536000"
    });

    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("IMAGE PROXY ERROR:", err);
    return res.status(500).send("Proxy error");
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

    await page.setDefaultNavigationTimeout(120000);
    await page.setDefaultTimeout(120000);

    if (options.html_url) {
      await page.goto(options.html_url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeout || 120000
      });
    } else {
      await page.setContent(html, {
        waitUntil: "domcontentloaded",
        timeout: options.timeout || 120000
      });
    }

    //
    // 🔥 FIXED IMAGE WAIT (handles proxy + slow loads)
    //
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.every(img => img.complete && img.naturalHeight !== 0);
    }, { timeout: 60000 });

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      timeout: options.timeout || 120000,

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
  } finally {
    if (browser) await browser.close();
  }
}

app.post("/generate-pdf", async (req, res) => {
  try {
    const { html, html_url, headerTemplate, footerTemplate, waitUntil, timeout } = req.body || {};

    if ((!html || typeof html !== "string") && !html_url) {
      return res.status(400).json({ error: "Missing html or html_url payload" });
    }

    const pdf = await buildPdf(html, headerTemplate, footerTemplate, {
      html_url,
      waitUntil,
      timeout
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="inspection-report.pdf"',
      "Cache-Control": "no-store"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("PDF GENERATION FAILED:", err?.stack || err);
    return res.status(500).json({ error: "PDF generation failed" });
  }
});

app.listen(PORT, () => {
  console.log("running");
});

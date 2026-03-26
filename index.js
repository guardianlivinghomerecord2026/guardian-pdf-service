import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "guardian-pdf-service"
  });
});

async function launchBrowser() {
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    protocolTimeout: 120000
  });
}

async function addPageNumbers(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const text = `Page ${index + 1} of ${totalPages}`;
    const fontSize = 8;
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    page.drawText(text, {
      x: width - textWidth - 24,
      y: 14,
      size: fontSize,
      font,
      color: rgb(0.42, 0.42, 0.42)
    });
  });

  return await pdfDoc.save();
}

async function buildPdfFromHtml(html) {
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    page.on("console", (msg) => {
      console.log("PAGE LOG:", msg.text());
    });

    page.on("pageerror", (err) => {
      console.error("PAGE ERROR:", err?.message || err);
    });

    page.on("requestfailed", (request) => {
      console.warn(
        "REQUEST FAILED:",
        request.url(),
        request.failure()?.errorText || "unknown"
      );
    });

    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1
    });

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 120000
    });

    await page.emulateMediaType("print");

    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        })
      );

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%; font-size:8px; color:#6b7280; padding:0 8mm;">
          <div style="width:100%; text-align:center;">
            Confidential Property Report
          </div>
        </div>
      `,
      margin: {
        top: "10mm",
        right: "8mm",
        bottom: "20mm",
        left: "8mm"
      },
      timeout: 120000
    });

    return await addPageNumbers(pdf);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error("BROWSER CLOSE ERROR:", err?.message || err);
      }
    }
  }
}

app.post("/generate-pdf", async (req, res) => {
  try {
    const { html } = req.body || {};

    if (!html || typeof html !== "string") {
      return res.status(400).json({
        error: "Missing html payload"
      });
    }

    console.log("PDF REQUEST RECEIVED. HTML LENGTH:", html.length);

    const pdf = await buildPdfFromHtml(html);

    console.log("PDF GENERATED SUCCESSFULLY. BYTES:", pdf.length);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="inspection-report.pdf"',
      "Cache-Control": "no-store"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("PDF GENERATION FAILED:", err?.stack || err);
    return res.status(500).json({
      error: "PDF generation failed"
    });
  }
});

app.get("/test-pdf", async (_req, res) => {
  try {
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Guardian PDF Page Number Test</title>
          <style>
            @page {
              size: Letter;
              margin: 12mm;
            }

            body {
              font-family: Arial, sans-serif;
              color: #111827;
              background: #ffffff;
            }

            h1 {
              margin-bottom: 16px;
            }

            .box {
              border: 1px solid #374151;
              border-radius: 8px;
              padding: 16px;
              margin-bottom: 12px;
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .spacer {
              height: 1200px;
            }
          </style>
        </head>
        <body>
          <h1>Guardian PDF Page Number Test</h1>
          <div class="box">This should show page numbers in the bottom-right corner.</div>
          <div class="spacer"></div>
          <div class="box">This should be page 2.</div>
        </body>
      </html>
    `;

    const pdf = await buildPdfFromHtml(html);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="guardian-test.pdf"',
      "Cache-Control": "no-store"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("TEST PDF FAILED:", err?.stack || err);
    return res.status(500).json({
      error: "Test PDF failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});

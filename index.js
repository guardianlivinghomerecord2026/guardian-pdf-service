import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

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

async function buildPdfFromHtml(html, pdfOptions = {}) {
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

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
      displayHeaderFooter: Boolean(pdfOptions.displayHeaderFooter),
      headerTemplate:
        pdfOptions.headerTemplate ||
        `<div style="width:100%; font-size:8px; padding:0 8mm; color:#6b7280; text-align:center;"></div>`,
      footerTemplate:
        pdfOptions.footerTemplate ||
        `<div style="width:100%; font-size:8px; padding:0 8mm; color:#6b7280; text-align:center;"></div>`,
      margin:
        pdfOptions.margin || {
          top: "20mm",
          right: "8mm",
          bottom: "20mm",
          left: "8mm"
        },
      timeout: 120000
    });

    return pdf;
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
    const { html, pdfOptions = {} } = req.body || {};

    if (!html || typeof html !== "string") {
      return res.status(400).json({
        error: "Missing html payload"
      });
    }

    const pdf = await buildPdfFromHtml(html, pdfOptions);

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
          <title>Guardian PDF Test</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #111827;
              background: #ffffff;
              padding: 24px;
            }
            .spacer {
              height: 1200px;
            }
          </style>
        </head>
        <body>
          <h1>Guardian PDF Test</h1>
          <p>This test should show a header, a footer, and page numbers.</p>
          <div class="spacer"></div>
          <p>Second page content.</p>
        </body>
      </html>
    `;

    const pdf = await buildPdfFromHtml(html, {
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm; color:#6b7280;">
          <div style="display:flex; justify-content:space-between; width:100%;">
            <span>198 Country Club Drive</span>
            <span>Guardian Living Home Record</span>
            <span>Prepared for: Jeremy Tresler</span>
          </div>
        </div>
      `,
      footerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm; color:#6b7280;">
          <div style="display:flex; justify-content:space-between; width:100%;">
            <span>J&H Fixall</span>
            <span>Confidential Property Report</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        </div>
      `,
      margin: {
        top: "20mm",
        right: "8mm",
        bottom: "20mm",
        left: "8mm"
      }
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="guardian-test.pdf"',
      "Cache-Control": "no-store"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("TEST PDF FAILED:", err?.stack || err);
    return res.status(500).send("Test PDF failed");
  }
});

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});

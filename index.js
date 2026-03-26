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

async function buildPdf(html, headerTemplate, footerTemplate) {
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0"
    });

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
  } finally {
    if (browser) await browser.close();
  }
}

app.post("/generate-pdf", async (req, res) => {
  try {
    const { html, headerTemplate, footerTemplate } = req.body || {};

    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Missing html payload" });
    }

    const pdf = await buildPdf(html, headerTemplate, footerTemplate);

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

app.get("/test-pdf", async (_req, res) => {
  try {
    const html = `
      <html>
        <body style="font-family: Arial; padding:20px;">
          <h1>Page 1</h1>
          <div style="height:1200px;"></div>
          <h1>Page 2</h1>
        </body>
      </html>
    `;

    const pdf = await buildPdf(
      html,
      `
      <div style="width:100%; font-size:8px; color:#6b7280; padding:0 10mm;">
        <div style="display:flex; justify-content:space-between;">
          <div>198 Country Club Dr, Grass Valley, CA</div>
          <div>Guardian Living Home Record</div>
          <div>Prepared for: Jeremy Tresler</div>
        </div>
      </div>
      `,
      `<div></div>`
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=test.pdf"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("TEST PDF FAILED:", err?.stack || err);
    return res.status(500).send("Test PDF failed");
  }
});

app.listen(PORT, () => {
  console.log("running");
});

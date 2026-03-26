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
    const text = `Page ${i + 1} of ${totalPages}`;
    const size = 8;

    const textWidth = font.widthOfTextAtSize(text, size);

    page.drawText(text, {
      x: width - textWidth - 20,
      y: 12,
      size,
      font,
      color: rgb(0.4, 0.4, 0.4)
    });
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function buildPdf(html) {
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
      margin: {
        top: "10mm",
        bottom: "20mm",
        left: "8mm",
        right: "8mm"
      }
    });

    return await addPageNumbers(pdf);
  } finally {
    if (browser) await browser.close();
  }
}

app.get("/test-pdf", async (_req, res) => {
  const html = `
    <html>
      <body style="font-family: Arial; padding:20px;">
        <h1>Page 1</h1>
        <div style="height:1200px;"></div>
        <h1>Page 2</h1>
      </body>
    </html>
  `;

  const pdf = await buildPdf(html);

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=test.pdf"
  });

  res.send(pdf);
});

app.listen(PORT, () => {
  console.log("running");
});

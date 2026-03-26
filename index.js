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

// ✅ ADD THIS TEST ROUTE BACK
app.get("/test-pdf", async (_req, res) => {
  try {
    const html = `
      <html>
        <body>
          <h1>PDF Test Page</h1>
          <p>This should show header, footer, and page numbers.</p>
          <div style="height:1200px;"></div>
        </body>
      </html>
    `;

    const pdf = await buildPdfFromHtml(html);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="test.pdf"'
    });

    return res.send(pdf);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Test PDF failed");
  }
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

async function buildPdfFromHtml(html) {
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

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,

      headerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm;">
          <div style="display:flex; justify-content:space-between;">
            <span>Test Address</span>
            <span>Guardian Living Home Record</span>
            <span>Client Name</span>
          </div>
        </div>
      `,

      footerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm;">
          <div style="display:flex; justify-content:space-between;">
            <span>J&H Fixall</span>
            <span>Confidential</span>
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

    return pdf;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});

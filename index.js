import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "guardian-pdf-service"
  });
});

/* ================================
   SIMPLE WORKING BROWSER
================================ */
async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

/* ================================
   BUILD PDF
================================ */
async function buildPdfFromHtml(html, pdfOptions = {}) {
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"]
    });

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,

      headerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm;">
          <div style="display:flex; justify-content:space-between;">
            <span>198 Country Club Drive</span>
            <span>Guardian Living Home Record</span>
            <span>Prepared for: Jeremy Tresler</span>
          </div>
        </div>
      `,

      footerTemplate: `
        <div style="width:100%; font-size:8px; padding:0 8mm;">
          <div style="text-align:center;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        </div>
      `,

      margin: {
        top: "20mm",
        bottom: "20mm"
      }
    });

    return pdf;

  } finally {
    if (browser) await browser.close();
  }
}

/* ================================
   TEST ROUTE
================================ */
app.get("/test-pdf", async (_req, res) => {
  try {
    const html = `
      <html>
        <body style="font-family: Arial; padding:40px;">
          <h1>PDF TEST</h1>
          <div style="height:1200px;"></div>
          <p>Second page</p>
        </body>
      </html>
    `;

    const pdf = await buildPdfFromHtml(html);

    res.set({
      "Content-Type": "application/pdf"
    });

    res.send(pdf);

  } catch (err) {
    console.error(err);
    res.status(500).send("FAILED");
  }
});

app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});

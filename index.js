import express from "express";
import puppeteer from "puppeteer";

const app = express();

// Bigger limit for long reports with many images/styles
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 10000;

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "guardian-pdf-service" });
});

app.post("/generate-pdf", async (req, res) => {
  let browser;

  try {
    const { html } = req.body || {};

    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Missing html payload" });
    }

    console.log("PDF request received. HTML length:", html.length);

    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 120000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none"
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1
    });

    // Better console visibility from inside the page
    page.on("console", (msg) => {
      console.log("PAGE LOG:", msg.text());
    });

    page.on("pageerror", (err) => {
      console.error("PAGE ERROR:", err.message);
    });

    page.on("requestfailed", (request) => {
      console.warn(
        "REQUEST FAILED:",
        request.url(),
        request.failure()?.errorText || "unknown"
      );
    });

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 120000
    });

    await page.emulateMediaType("print");

    // Wait for images + fonts inside the rendered document
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
      preferCSSPageSize: true,
      margin: {
        top: "10mm",
        right: "8mm",
        bottom: "14mm",
        left: "8mm"
      },
      timeout: 120000
    });

    console.log("PDF generated successfully. Bytes:", pdf.length);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="inspection-report.pdf"',
      "Cache-Control": "no-store"
    });

    return res.send(pdf);
  } catch (err) {
    console.error("PDF generation failed:", err);
    return res.status(500).json({
      error: "PDF generation failed"
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("Browser close error:", closeErr);
      }
    }
  }
});

// Small test route to prove Puppeteer itself works even without your app HTML
app.get("/test-pdf", async (_req, res) => {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 120000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();

    await page.setContent(`
      <html>
        <head>
          <style>
            @page { size: letter; margin: 12mm; }
            body { font-family: Arial, sans-serif; }
            .box {
              border: 1px solid #333;
              padding: 16px;
              margin-bottom: 12px;
              break-inside: avoid;
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body>
          <h1>Guardian PDF Test</h1>
          <div class="box">If you can download this PDF, Puppeteer is working on Render.</div>
          <div class="box">Next step is debugging your report HTML/assets if the main route still fails.</div>
        </body>
      </html>
    `, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 120000
    });

    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="guardian-test.pdf"'
    });

    return res.send(pdf);
  } catch (err) {
    console.error("Test PDF failed:", err);
    return res.status(500).json({ error: "Test PDF failed" });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
});

app.listen(PORT, () => {
  console.log(`PDF service running on port ${PORT}`);
});

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');
const { renderPinterestTemplate } = require('./templates/pinterest-template');
const { VideoRenderValidationError, renderVideoToMp4 } = require('./renderer/video-renderer');
const { launchBrowser } = require('./core/puppeteer');

dotenv.config({ path: path.join(__dirname, '.env') });

process.on('uncaughtException', (error) => {
  console.error('Unhandled uncaughtException:');
  console.error(error && error.stack ? error.stack : error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:');
  console.error(promise);
  console.error('Reason:');
  console.error(reason && reason.stack ? reason.stack : reason);
});

const app = express();
const port = Number.parseInt(process.env.RENDERER_PORT || process.env.PORT || '3000', 10);
const expectedApiKey = process.env.RENDERER_API_KEY || '';
const rendersDirectory = path.join(__dirname, 'renders');
const videosDirectory = path.join(rendersDirectory, 'videos');
const renderTimeoutMs = Number.parseInt(process.env.RENDERER_TIMEOUT_MS || '120000', 10);

app.use(express.json({ limit: '1mb' }));
app.use('/renders', express.static(path.join(__dirname, 'renders')));

function safeFilenamePart(value) {
  const sanitized = String(value || 'pin')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 70);
  return sanitized || 'pin';
}

function uniqueRenderFilename(headline) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${safeFilenamePart(headline)}-${suffix}.png`;
}

function isValidImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function hasValidApiKey(request) {
  return Boolean(expectedApiKey) && request.get('x-api-key') === expectedApiKey;
}

function buildPublicBaseUrl(request) {
  if (process.env.RENDERER_PUBLIC_BASE_URL) {
    return process.env.RENDERER_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const forwardedProto = request.get('x-forwarded-proto');
  const forwardedHost = request.get('x-forwarded-host');
  const host = forwardedHost || request.get('host') || `localhost:${port}`;
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : request.protocol || 'http';
  return `${protocol}://${host}`.replace(/\/$/, '');
}

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'renderer' });
});

app.get('/', (_request, response) => {
  response.json({ status: 'ok', service: 'renderer' });
});

app.post('/render', async (request, response, next) => {
  if (!hasValidApiKey(request)) {
    console.warn('Rejected render request with invalid or missing API key');
    return response.status(401).json({ error: 'Unauthorized: provide a valid x-api-key header.' });
  }

  const data = request.body && typeof request.body === 'object' ? request.body : {};
  if (!String(data.productImage || '').trim() || !String(data.headline || '').trim()) {
    return response.status(400).json({ error: 'Both productImage and headline are required.' });
  }
  if (!isValidImageUrl(String(data.productImage).trim())) {
    return response.status(400).json({ error: 'productImage must be a valid http or https URL.' });
  }

  let browser;
  let page;
  try {
    await fs.mkdir(rendersDirectory, { recursive: true });
    const filename = uniqueRenderFilename(data.headline);
    const outputPath = path.join(rendersDirectory, filename);
    const html = renderPinterestTemplate(data);

    console.log(`Rendering pin for headline: "${safeFilenamePart(data.headline)}"`);
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1500, deviceScaleFactor: 1 });
    await page.setDefaultNavigationTimeout(renderTimeoutMs);
    await page.setDefaultTimeout(renderTimeoutMs);
    await page.setContent(html, { waitUntil: 'load', timeout: renderTimeoutMs });

    const imageLoaded = await page.evaluate(async (timeout) => {
      const image = document.querySelector('.product');
      if (!image) return false;
      if (image.complete) return image.naturalWidth > 0;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeout);
        image.addEventListener('load', () => { clearTimeout(timer); resolve(image.naturalWidth > 0); }, { once: true });
        image.addEventListener('error', () => { clearTimeout(timer); resolve(false); }, { once: true });
      });
    }, renderTimeoutMs);

    if (!imageLoaded) {
      return response.status(422).json({ error: 'The product image could not be loaded.' });
    }

    const png = await page.screenshot({ type: 'png', fullPage: false });
    await fs.writeFile(outputPath, png);
    console.log(`Saved render: ${path.relative(__dirname, outputPath)}`);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.type('png').send(png);
  } catch (error) {
    console.error(`Render failed: ${error.message}`);
    next(error);
  } finally {
    if (page) await page.close().catch((error) => console.warn(`Page cleanup failed: ${error.message}`));
    if (browser) await browser.close().catch((error) => console.warn(`Browser cleanup failed: ${error.message}`));
  }
});

app.post('/render-video', async (request, response) => {
  const receivedBody = request.body && typeof request.body === 'object' ? request.body : {};
  const testMode = request.body && (request.body.test_mode === true || request.body.test_mode === 'true');
  const width = testMode ? 360 : Number(receivedBody.width ?? 1080);
  const height = testMode ? 640 : Number(receivedBody.height ?? 1920);
  const duration = testMode ? 5 : Number(receivedBody.duration ?? 40);
  const fps = testMode ? 10 : Number(receivedBody.fps ?? 30);
  const totalFrames = Math.round(duration * fps);

  console.log(`[render-video] ${new Date().toISOString()} request received`, {
    received_test_mode: request.body ? request.body.test_mode : undefined,
    effective_width: width,
    effective_height: height,
    effective_duration: duration,
    effective_fps: fps,
    total_frames: totalFrames
  });

  if (!hasValidApiKey(request)) {
    console.warn(`[render-video] ${new Date().toISOString()} rejected video render request with invalid or missing API key`);
    return response.status(401).json({ error: 'Unauthorized: provide a valid x-api-key header.' });
  }

  const data = {
    ...receivedBody,
    width,
    height,
    duration,
    fps,
    test_mode: testMode
  };
  const filename = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  const outputPath = path.join(videosDirectory, filename);

  try {
    await fs.mkdir(videosDirectory, { recursive: true });
    console.log(`[render-video] ${new Date().toISOString()} payload received`, data);

    await renderVideoToMp4(data, outputPath, { timeoutMs: renderTimeoutMs });

    const mp4Url = new URL(`/renders/videos/${filename}`, buildPublicBaseUrl(request)).toString();
    console.log(`[render-video] ${new Date().toISOString()} output completed`, { filename, outputPath, mp4Url });
    console.log(`[render-video] ${new Date().toISOString()} final response sent`, { filename, mp4Url });
    response.json({ success: true, mp4_url: mp4Url, filename });
  } catch (error) {
    const stack = error && error.stack ? error.stack : String(error);
    const message = error instanceof VideoRenderValidationError ? error.message : (error && error.message) || 'Video rendering failed.';

    console.error(`[render-video] ${new Date().toISOString()} caught error`);
    console.error(stack);

    return response.status(error instanceof VideoRenderValidationError ? 400 : 500).json({
      success: false,
      error: message,
      stack
    });
  }
});

app.use((error, _request, response, _next) => {
  if (response.headersSent) return;
  const status = error.type === 'entity.too.large' ? 413 : 500;
  response.status(status).json({ 
    error: error.message || 'Unable to render the Pinterest image.',
    stack: error.stack 
  });
});

app.listen(port, () => {
  console.log(`Pinterest renderer listening on port ${port}`);
  if (!expectedApiKey) console.warn('RENDERER_API_KEY is not configured; /render requests will be rejected.');
});
const puppeteer = require('puppeteer');

async function launchBrowser(overrides = {}) {
  const defaults = {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };
  const launchOptions = {
    ...defaults,
    ...overrides,
    args: [...defaults.args, ...(overrides.args || [])]
  };

  return puppeteer.launch(launchOptions);
}

module.exports = { launchBrowser };
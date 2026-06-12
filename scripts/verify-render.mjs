import { chromium } from 'playwright-core';

const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:5195/';
const chromePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const errors = [];
const screenshots = [];
const expectedSettingsIconUrl = new URL('/asset/setting.png', url).href;

function screenshotPath(name) {
  const path = `/private/tmp/gomoku-404-${name}.png`;
  screenshots.push(path);
  return path;
}

async function sample(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const points = [
      [0.5, 0.5],
      [0.42, 0.42],
      [0.58, 0.58],
      [0.28, 0.68],
      [0.72, 0.32],
    ];
    let lit = 0;
    let checksum = 0;

    for (const [x, y] of points) {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(canvas.width * x),
        Math.floor(canvas.height * y),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      checksum += pixel[0] * 3 + pixel[1] * 5 + pixel[2] * 7 + pixel[3];
      if (pixel[0] + pixel[1] + pixel[2] > 30) lit += 1;
    }

    return {
      appClass: document.querySelector('#app').className,
      checksum,
      heroVisible: getComputedStyle(document.querySelector('#hero')).opacity,
      lit,
      resultHidden: document.querySelector('#result-panel').classList.contains('hidden'),
      retryText: document.querySelector('#retry-button').textContent.trim(),
      selectedDifficulty: document.querySelector('[data-option="difficulty"].is-selected')?.dataset.value ?? '',
      selectedForbiddenRule: document.querySelector('[data-option="forbiddenRule"].is-selected')?.dataset.value ?? '',
      settingsButtonBackground: getComputedStyle(document.querySelector('#settings-button')).backgroundColor,
      settingsButtonBorderWidth: getComputedStyle(document.querySelector('#settings-button')).borderTopWidth,
      settingsButtonOpacity: getComputedStyle(document.querySelector('#settings-button')).opacity,
      settingsButtonTransform: getComputedStyle(document.querySelector('#settings-button')).transform,
      settingsIconLoaded: document.querySelector('#settings-button img')?.naturalWidth > 0,
      settingsIconSrc: document.querySelector('#settings-button img')?.src ?? '',
      settingsPanelHidden: document.querySelector('#settings-panel').classList.contains('hidden'),
      status: document.querySelector('#micro-status').textContent,
      statusHidden: document.querySelector('#micro-status').classList.contains('hidden'),
    };
  });
}

async function apiState(page) {
  return page.evaluate(() =>
    fetch('/api/new', {
      body: JSON.stringify({ humanPlayer: 'random' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).then((response) => response.json()),
  );
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const initial = await sample(page);
await page.screenshot({ path: screenshotPath('initial'), fullPage: false });

await page.keyboard.press('KeyO');
await page.waitForTimeout(1400);
const started = await sample(page);
await page.screenshot({ path: screenshotPath('started'), fullPage: false });

await page.click('#settings-button');
await page.click('[data-option="difficulty"][data-value="hard"]');
await page.click('[data-option="forbiddenRule"][data-value="renju"]');
await page.waitForTimeout(400);
const optionsOpen = await sample(page);
await page.screenshot({ path: screenshotPath('options'), fullPage: false });
await page.keyboard.press('Escape');
await page.waitForTimeout(120);

const center = {
  x: Math.round(page.viewportSize().width / 2),
  y: Math.round(page.viewportSize().height / 2),
};
await page.mouse.click(center.x, center.y);
await page.waitForTimeout(1200);
const afterClick = await sample(page);
await page.screenshot({ path: screenshotPath('after-click'), fullPage: false });

const randomSession = await apiState(page);
await browser.close();

const result = { afterClick, errors, initial, optionsOpen, randomSession, screenshots, started };
console.log(JSON.stringify(result, null, 2));

if (
  errors.length ||
  !started.appClass.includes('is-started') ||
  started.lit < 4 ||
  started.heroVisible > 0.2 ||
  started.retryText !== '다시하기' ||
  !started.resultHidden ||
  initial.selectedForbiddenRule !== 'none' ||
  started.selectedForbiddenRule !== 'none' ||
  Number(initial.settingsButtonOpacity) > 0.1 ||
  Number(started.settingsButtonOpacity) < 0.8 ||
  started.settingsButtonBackground !== 'rgba(0, 0, 0, 0)' ||
  started.settingsButtonBorderWidth !== '0px' ||
  !started.settingsIconLoaded ||
  started.settingsIconSrc !== expectedSettingsIconUrl ||
  optionsOpen.settingsPanelHidden ||
  optionsOpen.settingsButtonTransform !== 'none' ||
  optionsOpen.selectedDifficulty !== 'hard' ||
  optionsOpen.selectedForbiddenRule !== 'renju' ||
  randomSession.options?.forbiddenRule !== 'none' ||
  randomSession.humanPlayer !== 1 && randomSession.humanPlayer !== 2 ||
  randomSession.serverPlayer !== 1 && randomSession.serverPlayer !== 2 ||
  randomSession.humanPlayer === randomSession.serverPlayer ||
  !started.appClass.includes('human-white')
) {
  process.exit(1);
}

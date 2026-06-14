import { chromium } from 'playwright-core';

const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:5195/';
const chromePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const errors = [];
const screenshots = [];
const expectedSettingsIconUrl = new URL('/asset/setting.png', url).href;
const optionsStorageKey = 'gomoku-404-options';

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
      debug: window.__GOMOKU_404_DEBUG__?.getState?.() ?? null,
      openingSwapHidden: document.querySelector('#opening-swap-panel').classList.contains('hidden'),
      selectedDifficulty: document.querySelector('[data-option="difficulty"].is-selected')?.dataset.value ?? '',
      selectedForbiddenRule: document.querySelector('[data-option="forbiddenRule"].is-selected')?.dataset.value ?? '',
      selectedHumanPlayer: document.querySelector('[data-option="humanPlayer"].is-selected')?.dataset.value ?? '',
      selectedTacticStyle: document.querySelector('[data-option="tacticStyle"].is-selected')?.dataset.value ?? '',
      settingsButtonBackground: getComputedStyle(document.querySelector('#settings-button')).backgroundColor,
      settingsButtonBorderWidth: getComputedStyle(document.querySelector('#settings-button')).borderTopWidth,
      settingsButtonOpacity: getComputedStyle(document.querySelector('#settings-button')).opacity,
      settingsButtonTransform: getComputedStyle(document.querySelector('#settings-button')).transform,
      settingsIconLoaded: document.querySelector('#settings-button img')?.naturalWidth > 0,
      settingsIconSrc: document.querySelector('#settings-button img')?.src ?? '',
      settingsPanelHidden: document.querySelector('#settings-panel').classList.contains('hidden'),
      sideRestartHintHidden: document.querySelector('#side-restart-hint').classList.contains('hidden'),
      sideRestartHintTag: document.querySelector('#side-restart-hint').tagName,
      sideRestartHintText: document.querySelector('#side-restart-hint').textContent.trim(),
      status: document.querySelector('#micro-status').textContent,
      statusHidden: document.querySelector('#micro-status').classList.contains('hidden'),
    };
  });
}

async function pinchZoom(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    function fire(type, pointerId, x, y) {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          cancelable: true,
          clientX: x,
          clientY: y,
          isPrimary: pointerId === 41,
          pointerId,
          pointerType: 'touch',
        }),
      );
    }

    fire('pointerdown', 41, centerX - 42, centerY);
    fire('pointerdown', 42, centerX + 42, centerY);
    fire('pointermove', 41, centerX - 122, centerY);
    fire('pointermove', 42, centerX + 122, centerY);
    fire('pointerup', 41, centerX - 122, centerY);
    fire('pointerup', 42, centerX + 122, centerY);
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

await page.addInitScript((key) => {
  if (sessionStorage.getItem('gomoku-render-init')) return;
  sessionStorage.setItem('gomoku-render-init', '1');
  localStorage.setItem(
    key,
    JSON.stringify({
      difficulty: 'expert',
      forbiddenRule: 'none',
      humanPlayer: 'white',
      tacticStyle: 'defensive',
    }),
  );
}, optionsStorageKey);

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const initial = await sample(page);
await page.screenshot({ path: screenshotPath('initial'), fullPage: false });

await page.keyboard.press('KeyO');
await page.waitForTimeout(1400);
const started = await sample(page);
await page.screenshot({ path: screenshotPath('started'), fullPage: false });

await page.click('#opening-swap-button');
await page.waitForTimeout(700);
const swappedOpening = await sample(page);
await page.screenshot({ path: screenshotPath('swapped-opening'), fullPage: false });

await pinchZoom(page);
await page.waitForTimeout(500);
const pinched = await sample(page);
await page.screenshot({ path: screenshotPath('pinched'), fullPage: false });

await page.click('#settings-button');
await page.click('[data-option="difficulty"][data-value="hard"]');
await page.click('[data-option="forbiddenRule"][data-value="renju"]');
await page.click('[data-option="tacticStyle"][data-value="aggressive"]');
await page.click('[data-option="humanPlayer"][data-value="black"]');
await page.waitForTimeout(400);
const optionsOpen = await sample(page);
const cachedOptions = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), optionsStorageKey);
await page.screenshot({ path: screenshotPath('options'), fullPage: false });
await page.click('#settings-restart-button');
await page.waitForTimeout(800);
const afterSettingsRestart = await sample(page);

const center = {
  x: Math.round(page.viewportSize().width / 2),
  y: Math.round(page.viewportSize().height / 2),
};
await page.mouse.click(center.x, center.y);
await page.waitForTimeout(1200);
const afterClick = await sample(page);
await page.screenshot({ path: screenshotPath('after-click'), fullPage: false });

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const reloaded = await sample(page);

const randomSession = await apiState(page);
await browser.close();

const result = {
  afterClick,
  afterSettingsRestart,
  cachedOptions,
  errors,
  initial,
  optionsOpen,
  pinched,
  randomSession,
  reloaded,
  screenshots,
  started,
  swappedOpening,
};
console.log(JSON.stringify(result, null, 2));

if (
  errors.length ||
  !started.appClass.includes('is-started') ||
  started.lit < 4 ||
  pinched.checksum === started.checksum ||
  started.heroVisible > 0.2 ||
  started.retryText !== '다시하기' ||
  !started.resultHidden ||
  started.openingSwapHidden ||
  started.debug?.historyLength !== 1 ||
  started.debug?.humanPlayer !== 2 ||
  started.debug?.currentPlayer !== 2 ||
  swappedOpening.openingSwapHidden !== true ||
  swappedOpening.debug?.historyLength !== 0 ||
  swappedOpening.debug?.humanPlayer !== 2 ||
  swappedOpening.debug?.currentPlayer !== 2 ||
  initial.selectedForbiddenRule !== 'none' ||
  initial.selectedHumanPlayer !== 'white' ||
  initial.selectedTacticStyle !== 'defensive' ||
  started.selectedForbiddenRule !== 'none' ||
  started.selectedHumanPlayer !== 'white' ||
  started.selectedTacticStyle !== 'defensive' ||
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
  optionsOpen.selectedHumanPlayer !== 'black' ||
  optionsOpen.selectedTacticStyle !== 'aggressive' ||
  optionsOpen.sideRestartHintHidden ||
  optionsOpen.sideRestartHintTag !== 'P' ||
  optionsOpen.sideRestartHintText !== '재시작 시 적용됩니다.' ||
  cachedOptions.difficulty !== 'hard' ||
  cachedOptions.forbiddenRule !== 'renju' ||
  cachedOptions.humanPlayer !== 'black' ||
  cachedOptions.tacticStyle !== 'aggressive' ||
  afterSettingsRestart.debug?.humanPlayer !== 1 ||
  afterSettingsRestart.debug?.currentPlayer !== 1 ||
  afterSettingsRestart.debug?.historyLength !== 0 ||
  !afterSettingsRestart.openingSwapHidden ||
  !afterSettingsRestart.settingsPanelHidden ||
  afterClick.debug?.historyLength < 2 ||
  reloaded.selectedDifficulty !== 'hard' ||
  reloaded.selectedForbiddenRule !== 'renju' ||
  reloaded.selectedHumanPlayer !== 'black' ||
  reloaded.selectedTacticStyle !== 'aggressive' ||
  randomSession.options?.forbiddenRule !== 'none' ||
  randomSession.options?.tacticStyle !== 'defensive' ||
  randomSession.humanPlayer !== 1 && randomSession.humanPlayer !== 2 ||
  randomSession.serverPlayer !== 1 && randomSession.serverPlayer !== 2 ||
  randomSession.humanPlayer === randomSession.serverPlayer ||
  !started.appClass.includes('human-white')
) {
  process.exit(1);
}

import * as THREE from './vendor/three/build/three.module.js';

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const HALF = Math.floor(SIZE / 2);
const GAP = 0.78;
const BOARD_SPAN = GAP * (SIZE - 1);
const BOARD_SIZE = BOARD_SPAN + 1.15;
const STONE_Y = 0.22;
const STONE_DROP_Y = 1.08;
const COMPUTER_MOVE_MIN_MS = 950;
const START_REVEAL_DELAY_MS = 290;
const START_INPUT_DELAY_MS = 710;
const DEFAULT_OPTIONS = {
  difficulty: 'expert',
  forbiddenRule: 'none',
  humanPlayer: 'white',
  tacticStyle: 'defensive',
};
const OPTIONS_STORAGE_KEY = 'gomoku-404-options';
const OPTION_VALUES = {
  difficulty: new Set(['normal', 'hard', 'expert']),
  forbiddenRule: new Set(['none', 'renju']),
  humanPlayer: new Set(['white', 'black', 'random']),
  tacticStyle: new Set(['defensive', 'aggressive']),
};
const moduleBaseUrl = new URL('.', import.meta.url);
const apiBaseUrl = new URL(window.GOMOKU_404_API_BASE ?? moduleBaseUrl.origin);
const settingsIconUrl = new URL('/asset/setting.png', apiBaseUrl).href;

class SimpleOrbitControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.dampingFactor = 0.08;
    this.enableDamping = true;
    this.maxDistance = 44;
    this.maxPolarAngle = Math.PI * 0.48;
    this.minDistance = 10;
    this.rotateSpeed = 0.005;
    this.target = new THREE.Vector3();
    this.zoomStep = 0.12;

    const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
    this.current = {
      phi: spherical.phi,
      radius: spherical.radius,
      theta: spherical.theta,
    };
    this.goal = { ...this.current };
    this.drag = {
      active: false,
      lastX: 0,
      lastY: 0,
      pointerId: null,
    };
    this.pinch = {
      active: false,
      startDistance: 0,
      startRadius: this.goal.radius,
    };
    this.activePointers = new Map();

    this.domElement.style.touchAction = 'none';
    this.domElement.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.domElement.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.domElement.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.domElement.addEventListener('pointercancel', (event) => this.handlePointerUp(event));
    this.domElement.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
  }

  clampGoal() {
    this.goal.phi = Math.min(this.maxPolarAngle, Math.max(0.18, this.goal.phi));
    this.goal.radius = Math.min(this.maxDistance, Math.max(this.minDistance, this.goal.radius));
  }

  pointerDistance() {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  beginPinch() {
    const distance = this.pointerDistance();
    if (!distance) return;
    this.pinch.active = true;
    this.pinch.startDistance = distance;
    this.pinch.startRadius = this.goal.radius;
    this.drag.active = false;
    this.drag.pointerId = null;
  }

  handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.domElement.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events used in render checks do not always create capturable pointers.
    }

    if (this.activePointers.size >= 2) {
      this.beginPinch();
      return;
    }

    this.drag.active = true;
    this.drag.lastX = event.clientX;
    this.drag.lastY = event.clientY;
    this.drag.pointerId = event.pointerId;
  }

  handlePointerMove(event) {
    const trackedPointer = this.activePointers.get(event.pointerId);
    if (!trackedPointer) return;
    event.preventDefault();
    trackedPointer.x = event.clientX;
    trackedPointer.y = event.clientY;

    if (this.activePointers.size >= 2) {
      if (!this.pinch.active) this.beginPinch();
      const distance = this.pointerDistance();
      if (distance) {
        this.goal.radius = this.pinch.startRadius * (this.pinch.startDistance / distance);
        this.clampGoal();
      }
      return;
    }

    if (!this.drag.active || event.pointerId !== this.drag.pointerId) return;
    const dx = event.clientX - this.drag.lastX;
    const dy = event.clientY - this.drag.lastY;
    this.drag.lastX = event.clientX;
    this.drag.lastY = event.clientY;

    this.goal.theta -= dx * this.rotateSpeed;
    this.goal.phi -= dy * this.rotateSpeed;
    this.clampGoal();
  }

  handlePointerUp(event) {
    if (!this.activePointers.has(event.pointerId) && event.pointerId !== this.drag.pointerId) return;
    this.activePointers.delete(event.pointerId);
    try {
      this.domElement.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may not exist for synthetic or cancelled touch events.
    }

    if (this.activePointers.size >= 2) {
      this.beginPinch();
      return;
    }

    this.pinch.active = false;
    if (this.activePointers.size === 1) {
      const [pointerId, point] = this.activePointers.entries().next().value;
      this.drag.active = true;
      this.drag.lastX = point.x;
      this.drag.lastY = point.y;
      this.drag.pointerId = pointerId;
      return;
    }

    this.drag.active = false;
    this.drag.pointerId = null;
  }

  handleWheel(event) {
    event.preventDefault();
    this.goal.radius *= event.deltaY > 0 ? 1 + this.zoomStep : 1 - this.zoomStep;
    this.clampGoal();
  }

  update() {
    const alpha = this.enableDamping ? this.dampingFactor : 1;
    this.current.theta += (this.goal.theta - this.current.theta) * alpha;
    this.current.phi += (this.goal.phi - this.current.phi) * alpha;
    this.current.radius += (this.goal.radius - this.current.radius) * alpha;

    const spherical = new THREE.Spherical(this.current.radius, this.current.phi, this.current.theta);
    this.camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(this.target));
    this.camera.lookAt(this.target);
  }
}

const app = document.querySelector('[data-gomoku-404]') ?? document.querySelector('#app') ?? document.body.appendChild(document.createElement('div'));
app.id = 'app';
app.innerHTML = `
  <canvas id="scene" aria-label="3D 오목판"></canvas>
  <main class="hero" id="hero">
    <h1>
      <span>4</span><button id="start-orb" type="button" aria-label="오목 시작">0</button><span>4</span>
    </h1>
    <p>NOT FOUND</p>
  </main>
  <div class="micro-status hidden" id="micro-status"></div>
  <button class="settings-button" id="settings-button" type="button" aria-label="옵션 열기" aria-expanded="false">
    <img src="${settingsIconUrl}" alt="" aria-hidden="true" />
  </button>
  <section class="settings-panel hidden" id="settings-panel" aria-label="옵션">
    <div class="settings-row">
      <span class="settings-label">난이도</span>
      <div class="segmented-control" role="group" aria-label="난이도">
        <button type="button" data-option="difficulty" data-value="normal">보통</button>
        <button type="button" data-option="difficulty" data-value="hard">강함</button>
        <button type="button" data-option="difficulty" data-value="expert">전문가</button>
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-label">금수</span>
      <div class="segmented-control is-two" role="group" aria-label="금수">
        <button type="button" data-option="forbiddenRule" data-value="none">끄기</button>
        <button type="button" data-option="forbiddenRule" data-value="renju">간이 렌주</button>
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-label">전술</span>
      <div class="segmented-control is-two" role="group" aria-label="전술">
        <button type="button" data-option="tacticStyle" data-value="defensive">방어적</button>
        <button type="button" data-option="tacticStyle" data-value="aggressive">공격적</button>
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-label">내 진영</span>
      <div class="segmented-control" role="group" aria-label="내 진영">
        <button type="button" data-option="humanPlayer" data-value="white">흰돌</button>
        <button type="button" data-option="humanPlayer" data-value="black">검은돌</button>
        <button type="button" data-option="humanPlayer" data-value="random">랜덤</button>
      </div>
      <p class="option-restart-hint hidden" id="side-restart-hint">재시작 시 적용됩니다.</p>
    </div>
    <div class="settings-action-row">
      <button class="settings-restart-button" id="settings-restart-button" type="button">
        <span class="retry-icon" aria-hidden="true"></span>
        <span>재시작하기</span>
      </button>
    </div>
  </section>
  <div class="opening-swap-panel hidden" id="opening-swap-panel">
    <button id="opening-swap-button" type="button">
      <span class="retry-icon" aria-hidden="true"></span>
      <span>진영 바꾸기</span>
    </button>
  </div>
  <div class="result-panel hidden" id="result-panel">
    <p id="result-message">승리</p>
    <button id="retry-button" type="button">
      <span class="retry-icon" aria-hidden="true"></span>
      <span>다시하기</span>
    </button>
  </div>
`;

const canvas = document.querySelector('#scene');
const hero = document.querySelector('#hero');
const startOrb = document.querySelector('#start-orb');
const microStatus = document.querySelector('#micro-status');
const settingsButton = document.querySelector('#settings-button');
const settingsPanel = document.querySelector('#settings-panel');
const settingsRestartButton = document.querySelector('#settings-restart-button');
const sideRestartHint = document.querySelector('#side-restart-hint');
const openingSwapPanel = document.querySelector('#opening-swap-panel');
const openingSwapButton = document.querySelector('#opening-swap-button');
const resultPanel = document.querySelector('#result-panel');
const resultMessage = document.querySelector('#result-message');
const retryButton = document.querySelector('#retry-button');

const state = {
  board: Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY)),
  currentPlayer: BLACK,
  hover: null,
  humanPlayer: BLACK,
  inputLocked: true,
  lastMove: null,
  openingSwapAvailable: false,
  sessionId: null,
  sideRestartPending: false,
  started: false,
  status: 'idle',
  thinking: false,
  options: readCachedOptions(),
  forbiddenMoves: [],
  winLine: [],
  winner: null,
};

const pointerGesture = {
  activePointers: new Set(),
  downX: 0,
  downY: 0,
  dragging: false,
  suppressClick: false,
};

const forbiddenMarkers = new Map();
const stones = new Map();
let forbiddenKeys = new Set();
let sessionHistory = [];
let statusTimer = null;
let hoverMarker;
let lastMoveMarker;
let winLineMesh;
let introProgress = 0;
let optionRequestVersion = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeee7da);
scene.fog = new THREE.Fog(0xeee7da, 18, 48);

const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 140);
camera.position.set(12.2, 13.2, 15.2);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const controls = new SimpleOrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 44;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(999, 999);
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18);
const pointerHit = new THREE.Vector3();
const boardRoot = new THREE.Group();
scene.add(boardRoot);

const materials = {
  board: new THREE.MeshStandardMaterial({ color: 0xcda96d, roughness: 0.58, metalness: 0.03 }),
  boardSide: new THREE.MeshStandardMaterial({ color: 0x4b3824, roughness: 0.62 }),
  line: new THREE.LineBasicMaterial({ color: 0x3f3023, transparent: true, opacity: 0.72 }),
  black: new THREE.MeshPhysicalMaterial({
    color: 0x080909,
    roughness: 0.28,
    metalness: 0.04,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  }),
  white: new THREE.MeshPhysicalMaterial({
    color: 0xf4f2eb,
    roughness: 0.2,
    metalness: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.18,
  }),
  shadow: new THREE.MeshBasicMaterial({
    color: 0x1b1812,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  }),
  hoverBlack: new THREE.MeshBasicMaterial({
    color: 0x111412,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  }),
  hoverWhite: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  }),
  last: new THREE.MeshBasicMaterial({
    color: 0x1d6f58,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  }),
  win: new THREE.MeshBasicMaterial({
    color: 0xb94336,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  }),
  forbidden: new THREE.MeshBasicMaterial({
    color: 0xb94336,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  }),
};

const forbiddenBarGeometry = new THREE.BoxGeometry(0.46, 0.026, 0.06);

function createBoardScene() {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9b8a70, 2.2));

  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-5, 11, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 32;
  scene.add(key);

  boardRoot.position.y = -2.2;
  boardRoot.scale.setScalar(0.76);

  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, 0.32, BOARD_SIZE), materials.board);
  board.position.y = -0.08;
  board.castShadow = true;
  board.receiveShadow = true;
  boardRoot.add(board);

  const side = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE + 0.18, 0.18, BOARD_SIZE + 0.18), materials.boardSide);
  side.position.y = -0.25;
  side.receiveShadow = true;
  boardRoot.add(side);

  const linePositions = [];
  const start = -BOARD_SPAN / 2;
  const end = BOARD_SPAN / 2;
  for (let index = 0; index < SIZE; index += 1) {
    const p = gridToWorld(index);
    linePositions.push(start, 0.095, p, end, 0.095, p);
    linePositions.push(p, 0.096, start, p, 0.096, end);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  boardRoot.add(new THREE.LineSegments(lineGeometry, materials.line));

  const starGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.018, 28);
  for (const [row, col] of [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11],
  ]) {
    const star = new THREE.Mesh(starGeometry, materials.boardSide);
    star.position.set(gridToWorld(col), 0.12, gridToWorld(row));
    boardRoot.add(star);
  }

  hoverMarker = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.38, 40), materials.hoverBlack);
  hoverMarker.rotation.x = -Math.PI / 2;
  hoverMarker.position.y = 0.135;
  hoverMarker.visible = false;
  boardRoot.add(hoverMarker);

  lastMoveMarker = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 52), materials.last);
  lastMoveMarker.rotation.x = -Math.PI / 2;
  lastMoveMarker.position.y = 0.112;
  lastMoveMarker.visible = false;
  boardRoot.add(lastMoveMarker);
}

function gridToWorld(index) {
  return (index - HALF) * GAP;
}

function worldToGrid(x, z) {
  const col = Math.round(x / GAP + HALF);
  const row = Math.round(z / GAP + HALF);
  if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return null;

  const snapX = gridToWorld(col);
  const snapZ = gridToWorld(row);
  if (Math.hypot(x - snapX, z - snapZ) > GAP * 0.42) return null;
  return { row, col };
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getPointerMove() {
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(boardPlane, pointerHit)) return null;
  return worldToGrid(pointerHit.x, pointerHit.z);
}

function keyFor(row, col) {
  return `${row},${col}`;
}

function moveNotation(row, col) {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeOptions(options = {}) {
  return {
    difficulty: OPTION_VALUES.difficulty.has(options.difficulty) ? options.difficulty : DEFAULT_OPTIONS.difficulty,
    forbiddenRule: OPTION_VALUES.forbiddenRule.has(options.forbiddenRule)
      ? options.forbiddenRule
      : DEFAULT_OPTIONS.forbiddenRule,
    humanPlayer: OPTION_VALUES.humanPlayer.has(options.humanPlayer)
      ? options.humanPlayer
      : DEFAULT_OPTIONS.humanPlayer,
    tacticStyle: OPTION_VALUES.tacticStyle.has(options.tacticStyle) ? options.tacticStyle : DEFAULT_OPTIONS.tacticStyle,
  };
}

function readCachedOptions() {
  try {
    return normalizeOptions(JSON.parse(localStorage.getItem(OPTIONS_STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function cacheOptions(options) {
  try {
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(normalizeOptions(options)));
  } catch {
    // Option persistence should never block gameplay.
  }
}

function optionsPayload(extra = {}) {
  return {
    difficulty: state.options.difficulty,
    forbiddenRule: state.options.forbiddenRule,
    humanPlayer: state.options.humanPlayer,
    tacticStyle: state.options.tacticStyle,
    ...extra,
  };
}

function updateSettingsControls() {
  for (const button of settingsPanel.querySelectorAll('[data-option]')) {
    const selected = state.options[button.dataset.option] === button.dataset.value;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  sideRestartHint.classList.toggle('hidden', !state.sideRestartPending);
}

function updateHumanPlayerClass() {
  app.classList.toggle('human-white', state.humanPlayer === WHITE);
  app.classList.toggle('human-black', state.humanPlayer === BLACK);
}

function openingCenterIsServerBlack(session) {
  if (!session || session.history?.length !== 1) return false;
  const [move] = session.history;
  return (
    move.source === 'server' &&
    move.player === BLACK &&
    move.row === HALF &&
    move.col === HALF &&
    session.humanPlayer === WHITE
  );
}

function updateOpeningSwapPanel() {
  const canShow =
    state.started &&
    state.openingSwapAvailable &&
    state.status === 'playing' &&
    sessionHistory.length === 1 &&
    sessionHistory[0]?.source === 'server' &&
    sessionHistory[0]?.player === BLACK &&
    state.board[HALF]?.[HALF] === BLACK;

  openingSwapPanel.classList.toggle('hidden', !canShow);
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
  settingsButton.setAttribute('aria-expanded', 'false');
}

function toggleSettingsPanel() {
  if (!state.started) return;
  const willOpen = settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !willOpen);
  settingsButton.setAttribute('aria-expanded', String(willOpen));
}

async function applyOption(name, value) {
  if (state.options[name] === value) return;
  state.options = normalizeOptions({ ...state.options, [name]: value });
  cacheOptions(state.options);
  if (name === 'humanPlayer') {
    state.sideRestartPending = true;
    updateSettingsControls();
    setStatus('다음 재시작부터 적용됩니다.');
    return;
  }

  updateSettingsControls();

  if (!state.started || !state.sessionId) return;
  if (state.status !== 'playing') {
    setStatus('옵션이 적용되었습니다.');
    return;
  }

  optionRequestVersion += 1;
  const requestVersion = optionRequestVersion;
  try {
    const session = await api('/api/options', {
      sessionId: state.sessionId,
      ...optionsPayload(),
    });
    if (requestVersion !== optionRequestVersion) return;
    updateUi(session);
    setStatus('옵션이 적용되었습니다.');
  } catch (error) {
    if (requestVersion !== optionRequestVersion) return;
    setStatus(error.message);
  }
}

function setStatus(text, persist = false) {
  clearTimeout(statusTimer);
  microStatus.textContent = text;
  microStatus.classList.toggle('hidden', !text);
  if (text && !persist) {
    statusTimer = setTimeout(() => microStatus.classList.add('hidden'), 1700);
  }
}

function updateTurnStatus() {
  const isHumanTurn =
    state.started &&
    state.status === 'playing' &&
    !state.thinking &&
    !state.inputLocked &&
    state.currentPlayer === state.humanPlayer;

  if (isHumanTurn) {
    setStatus('당신의 차례입니다.', true);
  }
}

function createStone(row, col, player, animated = true) {
  const group = new THREE.Group();
  const stone = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 40, 24),
    player === BLACK ? materials.black : materials.white,
  );
  stone.scale.y = 0.34;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.185;
  group.add(shadow);

  group.position.set(gridToWorld(col), animated ? STONE_DROP_Y : STONE_Y, gridToWorld(row));
  group.userData = {
    physics: {
      active: animated,
      bounce: 0,
      targetY: STONE_Y,
      velocity: animated ? -0.52 : 0,
    },
    player,
    row,
    col,
  };
  boardRoot.add(group);
  stones.set(keyFor(row, col), group);
}

function removeStone(row, col) {
  const key = keyFor(row, col);
  const stone = stones.get(key);
  if (!stone) return;
  boardRoot.remove(stone);
  stones.delete(key);
}

function createForbiddenMarker(row, col) {
  const group = new THREE.Group();
  const first = new THREE.Mesh(forbiddenBarGeometry, materials.forbidden);
  const second = new THREE.Mesh(forbiddenBarGeometry, materials.forbidden);
  first.rotation.y = Math.PI / 4;
  second.rotation.y = -Math.PI / 4;
  group.add(first, second);
  group.position.set(gridToWorld(col), 0.145, gridToWorld(row));
  group.userData = { row, col };
  boardRoot.add(group);
  forbiddenMarkers.set(keyFor(row, col), group);
}

function syncForbiddenMarkers(moves = []) {
  const nextKeys = new Set(moves.map((move) => keyFor(move.row, move.col)));

  for (const [key, marker] of forbiddenMarkers.entries()) {
    if (nextKeys.has(key)) continue;
    boardRoot.remove(marker);
    forbiddenMarkers.delete(key);
  }

  for (const move of moves) {
    const key = keyFor(move.row, move.col);
    if (forbiddenMarkers.has(key)) continue;
    createForbiddenMarker(move.row, move.col);
  }

  forbiddenKeys = nextKeys;
}

function isForbiddenCell(row, col) {
  return forbiddenKeys.has(keyFor(row, col));
}

function syncStones(nextBoard, history) {
  for (const [key, group] of stones.entries()) {
    const [row, col] = key.split(',').map(Number);
    if (nextBoard[row][col] === EMPTY) {
      boardRoot.remove(group);
      stones.delete(key);
    }
  }

  const previousMoves = new Set(sessionHistory.map((move) => keyFor(move.row, move.col)));
  const latestMoves = history.filter((move) => !previousMoves.has(keyFor(move.row, move.col)));

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const player = nextBoard[row][col];
      if (player === EMPTY || stones.has(keyFor(row, col))) continue;
      const isNew = latestMoves.some((move) => move.row === row && move.col === col);
      createStone(row, col, player, isNew);
    }
  }

  sessionHistory = history.map((move) => ({ ...move }));
}

function updateStonePhysics(delta) {
  for (const stone of stones.values()) {
    const physics = stone.userData.physics;
    if (!physics.active) continue;

    physics.velocity -= 18 * delta;
    stone.position.y += physics.velocity * delta;

    if (stone.position.y <= physics.targetY) {
      stone.position.y = physics.targetY;
      physics.velocity = Math.abs(physics.velocity) * 0.26;
      physics.bounce += 1;
      if (physics.bounce >= 2 || physics.velocity < 0.7) {
        physics.active = false;
        physics.velocity = 0;
      }
    }
  }
}

function updateIntro(delta) {
  if (!state.started || introProgress >= 1) return;
  introProgress = Math.min(1, introProgress + delta * 1.45);
  const eased = 1 - (1 - introProgress) ** 3;
  const scale = 0.76 + eased * 0.24;
  boardRoot.position.y = -2.2 + eased * 2.2;
  boardRoot.scale.setScalar(scale);
}

function updateHoverMarker() {
  const move = getPointerMove();
  state.hover = move;
  const canShow =
    move &&
    state.status === 'playing' &&
    !state.thinking &&
    !state.inputLocked &&
    state.currentPlayer === state.humanPlayer &&
    state.board[move.row][move.col] === EMPTY &&
    !isForbiddenCell(move.row, move.col);

  hoverMarker.visible = Boolean(canShow);
  hoverMarker.material = state.humanPlayer === BLACK ? materials.hoverBlack : materials.hoverWhite;
  if (canShow) {
    hoverMarker.position.x = gridToWorld(move.col);
    hoverMarker.position.z = gridToWorld(move.row);
  }
}

function updateLastMoveMarker() {
  lastMoveMarker.visible = Boolean(state.lastMove);
  if (state.lastMove) {
    lastMoveMarker.position.x = gridToWorld(state.lastMove.col);
    lastMoveMarker.position.z = gridToWorld(state.lastMove.row);
  }
}

function updateWinLine() {
  if (winLineMesh) {
    boardRoot.remove(winLineMesh);
    winLineMesh = null;
  }
  if (!state.winLine || state.winLine.length < 2) return;

  const first = state.winLine[0];
  const last = state.winLine[state.winLine.length - 1];
  const start = new THREE.Vector3(gridToWorld(first.col), 0.34, gridToWorld(first.row));
  const end = new THREE.Vector3(gridToWorld(last.col), 0.34, gridToWorld(last.row));
  const direction = end.clone().sub(start);
  const length = direction.length();
  winLineMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, length, 18), materials.win);
  winLineMesh.position.copy(start.clone().lerp(end, 0.5));
  winLineMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  boardRoot.add(winLineMesh);
}

function showResult(session) {
  if (session.status !== 'finished') {
    resultPanel.classList.add('hidden');
    return;
  }

  if (session.winner === state.humanPlayer) resultMessage.textContent = '승리';
  else if (session.winner === 3) resultMessage.textContent = '무승부';
  else resultMessage.textContent = '패배';
  setStatus('');
  resultPanel.classList.remove('hidden');
}

function updateUi(session) {
  state.board = session.board;
  state.currentPlayer = session.currentPlayer;
  state.humanPlayer = session.humanPlayer;
  state.sessionId = session.id;
  state.status = session.status;
  state.winner = session.winner;
  state.options = normalizeOptions({ ...state.options, ...(session.options ?? {}) });
  cacheOptions(state.options);
  state.forbiddenMoves = session.forbiddenMoves ?? [];
  state.winLine = session.winLine ?? [];
  state.lastMove = session.history.at(-1) ?? null;

  updateHumanPlayerClass();
  updateSettingsControls();
  syncStones(session.board, session.history);
  syncForbiddenMarkers(state.forbiddenMoves);
  updateHoverMarker();
  updateLastMoveMarker();
  updateWinLine();
  showResult(session);
  updateOpeningSwapPanel();
  updateTurnStatus();
}

async function api(path, payload = {}) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data;
}

function setRevealOrigin(x, y) {
  app.style.setProperty('--origin-x', `${x}px`);
  app.style.setProperty('--origin-y', `${y}px`);
}

function clearBoardScene() {
  state.forbiddenMoves = [];
  sessionHistory = [];
  for (const group of stones.values()) boardRoot.remove(group);
  stones.clear();
  syncForbiddenMarkers([]);
  if (winLineMesh) {
    boardRoot.remove(winLineMesh);
    winLineMesh = null;
  }
  lastMoveMarker.visible = false;
  hoverMarker.visible = false;
  resultPanel.classList.add('hidden');
  openingSwapPanel.classList.add('hidden');
}

async function startGame(event) {
  if (state.started) return;

  const rect = startOrb.getBoundingClientRect();
  const originX = event?.clientX ?? rect.left + rect.width / 2;
  const originY = event?.clientY ?? rect.top + rect.height / 2;
  setRevealOrigin(originX, originY);

  app.classList.add('is-starting');
  const session = await api('/api/new', optionsPayload({ humanPlayer: 'white' }));
  state.humanPlayer = session.humanPlayer;
  state.openingSwapAvailable = openingCenterIsServerBlack(session);
  updateHumanPlayerClass();

  await wait(START_REVEAL_DELAY_MS);
  state.started = true;
  app.classList.add('is-started');
  setStatus('');

  updateUi(session);

  await wait(START_INPUT_DELAY_MS);
  state.inputLocked = false;
  updateHoverMarker();
  updateTurnStatus();
}

async function restartMatch() {
  if (state.thinking) return;
  state.inputLocked = true;
  state.openingSwapAvailable = false;
  state.sideRestartPending = false;
  clearBoardScene();
  closeSettingsPanel();
  setStatus('');

  const session = await api('/api/new', optionsPayload());
  state.humanPlayer = session.humanPlayer;
  state.started = true;
  app.classList.add('is-starting', 'is-started');
  app.classList.remove('is-thinking');
  updateHumanPlayerClass();
  updateUi(session);

  await wait(520);
  state.inputLocked = false;
  updateHoverMarker();
  updateTurnStatus();
}

async function swapOpeningSide() {
  if (state.thinking || !state.openingSwapAvailable) return;
  state.inputLocked = true;
  state.openingSwapAvailable = false;
  clearBoardScene();
  setStatus('');

  const session = await api('/api/new', optionsPayload({ humanPlayer: 'black' }));
  state.humanPlayer = session.humanPlayer;
  state.started = true;
  app.classList.add('is-starting', 'is-started');
  app.classList.remove('is-thinking');
  updateHumanPlayerClass();
  updateUi(session);

  await wait(420);
  state.inputLocked = false;
  updateHoverMarker();
  updateTurnStatus();
}

async function playMove(row, col) {
  if (
    state.inputLocked ||
    state.thinking ||
    state.status !== 'playing' ||
    state.currentPlayer !== state.humanPlayer
  ) {
    return;
  }
  if (state.board[row][col] !== EMPTY) return;
  if (isForbiddenCell(row, col)) {
    setStatus('금수 구역입니다.');
    return;
  }

  state.openingSwapAvailable = false;
  updateOpeningSwapPanel();
  syncForbiddenMarkers([]);

  const previousBoard = state.board.map((line) => [...line]);
  const previousHistory = sessionHistory.map((move) => ({ ...move }));
  const previousLastMove = state.lastMove ? { ...state.lastMove } : null;
  const localMove = {
    player: state.humanPlayer,
    row,
    col,
    source: 'human',
    notation: moveNotation(row, col),
  };

  state.board = state.board.map((line) => [...line]);
  state.board[row][col] = state.humanPlayer;
  state.currentPlayer = state.humanPlayer === BLACK ? WHITE : BLACK;
  state.lastMove = localMove;
  state.thinking = true;
  sessionHistory = [...sessionHistory, localMove];
  const historyLengthBeforeResponse = sessionHistory.length;

  if (!stones.has(keyFor(row, col))) createStone(row, col, state.humanPlayer, true);
  updateLastMoveMarker();
  updateHoverMarker();
  app.classList.add('is-thinking');
  setStatus('서버가 두는 중', true);

  try {
    const startedAt = performance.now();
    const session = await api('/api/move', { sessionId: state.sessionId, row, col });
    const elapsed = performance.now() - startedAt;
    const serverMoveAdded = session.history.slice(historyLengthBeforeResponse).some((move) => move.source === 'server');
    if (serverMoveAdded && elapsed < COMPUTER_MOVE_MIN_MS) {
      await wait(COMPUTER_MOVE_MIN_MS - elapsed);
    }
    state.thinking = false;
    app.classList.remove('is-thinking');
    updateUi(session);
  } catch (error) {
    state.board = previousBoard;
    state.lastMove = previousLastMove;
    sessionHistory = previousHistory;
    removeStone(row, col);
    state.currentPlayer = state.humanPlayer;
    state.thinking = false;
    app.classList.remove('is-thinking');
    updateLastMoveMarker();
    updateHoverMarker();
    setStatus(error.message === '금수입니다.' ? '금수 구역입니다.' : error.message);
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

canvas.addEventListener('pointermove', (event) => {
  if (pointerGesture.activePointers.size > 1) {
    pointerGesture.dragging = true;
    pointerGesture.suppressClick = true;
    state.hover = null;
    hoverMarker.visible = false;
    return;
  }

  setPointer(event);
  if (event.buttons === 1) {
    const distance = Math.hypot(event.clientX - pointerGesture.downX, event.clientY - pointerGesture.downY);
    if (distance > 6) {
      pointerGesture.dragging = true;
      pointerGesture.suppressClick = true;
    }
  }
  updateHoverMarker();
});

canvas.addEventListener('pointerdown', (event) => {
  pointerGesture.activePointers.add(event.pointerId);
  if (pointerGesture.activePointers.size > 1) {
    pointerGesture.dragging = true;
    pointerGesture.suppressClick = true;
    state.hover = null;
    hoverMarker.visible = false;
    return;
  }

  pointerGesture.downX = event.clientX;
  pointerGesture.downY = event.clientY;
  pointerGesture.dragging = false;
  pointerGesture.suppressClick = false;
});

canvas.addEventListener('pointerup', (event) => {
  pointerGesture.activePointers.delete(event.pointerId);
  if (pointerGesture.dragging) pointerGesture.suppressClick = true;
});

canvas.addEventListener('pointercancel', (event) => {
  pointerGesture.activePointers.delete(event.pointerId);
  pointerGesture.dragging = false;
  pointerGesture.suppressClick = true;
});

canvas.addEventListener('pointerleave', () => {
  state.hover = null;
  hoverMarker.visible = false;
});

canvas.addEventListener('click', (event) => {
  if (pointerGesture.suppressClick) {
    pointerGesture.suppressClick = false;
    return;
  }
  setPointer(event);
  const move = getPointerMove();
  if (move) playMove(move.row, move.col);
});

startOrb.addEventListener('click', startGame);
retryButton.addEventListener('click', restartMatch);
openingSwapButton.addEventListener('click', swapOpeningSide);
settingsRestartButton.addEventListener('click', restartMatch);
settingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleSettingsPanel();
});
settingsPanel.addEventListener('click', (event) => {
  event.stopPropagation();
  const button = event.target.closest('[data-option]');
  if (!button) return;
  applyOption(button.dataset.option, button.dataset.value);
});
hero.addEventListener('click', (event) => {
  if (event.target === startOrb) return;
  startGame(event);
});
document.addEventListener('click', (event) => {
  if (!settingsPanel.contains(event.target) && !settingsButton.contains(event.target)) {
    closeSettingsPanel();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    closeSettingsPanel();
    return;
  }
  if (event.code === 'KeyO' || event.code === 'Digit0' || event.code === 'Numpad0' || event.code === 'Space') {
    startGame();
  }
});
window.addEventListener('resize', resize);

createBoardScene();
updateSettingsControls();
resize();

window.__GOMOKU_404_DEBUG__ = {
  getState: () => ({
    currentPlayer: state.currentPlayer,
    forbiddenMarkerCount: forbiddenMarkers.size,
    forbiddenMoveCount: state.forbiddenMoves.length,
    historyLength: sessionHistory.length,
    humanPlayer: state.humanPlayer,
    openingSwapAvailable: state.openingSwapAvailable,
    sideRestartPending: state.sideRestartPending,
    status: state.status,
  }),
};

const clock = new THREE.Clock();
function animate() {
  const delta = Math.min(clock.getDelta(), 0.034);
  updateIntro(delta);
  updateStonePhysics(delta);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

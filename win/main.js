'use strict';
// The Windows host for the web scene in ../web. Mirrors the mac build's App.swift/AppMenu.swift:
// a transparent, click-through floating window reports the pointer to the page, forwards global
// keyboard and mouse input, and offers the same tray menu. electron-updater handles updates.
const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const Store = require('./store');
const KeyMap = require('./keymap');

const isMac = process.platform === 'darwin';
const DESIGN = { width: 360, height: 368 }; // App.swift designSize at scale 1

let panel = null;
let tray = null;
let settingsWin = null;
let store = null;
let hook = null;
let hookReady = false;
let pageReady = false;
let hit = 'none';
let petting = false;
let dragging = false;
let dragStart = null;
let pendingDelta = { x: 0, y: 0 };
let lastCursor = { x: -9999, y: -9999 };
let keyEvents = 0;
const held = new Set();
let tickTimer = null;
let statusTimer = null;
let updateTimer = null;

const update = { state: 'idle', version: '', percent: 0 };

// MARK: Locations

const webDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web'));
const asset = name => (app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', name)
  : path.join(__dirname, 'assets', name));
const dataDir = () => app.getPath('userData');

function log(text) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(path.join(dataDir(), 'log.txt'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

// MARK: Settings (same keys as the mac build's UserDefaults)

const getStyle = () => store.get('style', '2d');
const getCoat = () => store.get('coat', 'black');
const getPattern = () => store.get(`pattern.${getCoat()}`, 'auto');
const getEyeColor = () => store.get('eyeColor', 'auto');
const getEyeShine = () => store.get('eyeShine', 'classic');
const getCollar = () => store.get('collar', 'none');
const getBlush = () => store.get('blush', false) === true;
const getWhiskers = () => store.get('whiskers', true) !== false;
const getPrivacy = () => store.get('privacy', false) === true;
const getSleepAfter = () => {
  const value = Number(store.get('sleepAfter', 60));
  return Number.isFinite(value) ? value : 60;
};
const getTune = () => store.get('tune', {}) || {};
const getScale = () => {
  const value = Number(store.get('catScale', 0.9));
  return Number.isFinite(value) && value > 0.3 ? value : 0.9;
};

function pushOptions() {
  const options = {
    style: getStyle(),
    coat: getCoat(),
    pattern: getPattern(),
    eye: getEyeColor(),
    shine: getEyeShine(),
    blush: getBlush(),
    whiskers: getWhiskers(),
    collar: getCollar(),
    privacy: getPrivacy(),
    sleepAfter: getSleepAfter() > 0 ? getSleepAfter() : 1e9,
    tune: getTune(),
  };
  js(`cat.options(${JSON.stringify(options)})`);
}

function js(script) {
  if (!pageReady || !panel || panel.isDestroyed()) return;
  panel.webContents.executeJavaScript(script).catch(() => {});
}

// MARK: Window

function windowSize() {
  const scale = getScale();
  return {
    width: Math.round(DESIGN.width * scale),
    height: Math.round(DESIGN.height * scale),
  };
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function savedOrigin() {
  const x = store.get('originX', null);
  const y = store.get('originY', null);
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const probe = { x, y, width: 80, height: 80 };
  return screen.getAllDisplays().some(display => intersects(display.bounds, probe)) ? { x, y } : null;
}

function defaultOrigin(size) {
  // Bottom-right of the work area (the taskbar is excluded), like the mac build.
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - size.width - 20),
    y: Math.round(area.y + area.height - size.height),
  };
}

function saveOrigin() {
  if (!panel || panel.isDestroyed()) return;
  const bounds = panel.getBounds();
  store.set('originX', bounds.x);
  store.set('originY', bounds.y);
}

function applyScale(value, keepOrigin) {
  const scale = Math.max(0.4, Math.min(2, Number(value) || 0.9));
  store.set('catScale', scale);
  const size = windowSize();
  const origin = keepOrigin && panel
    ? { x: panel.getBounds().x, y: panel.getBounds().y }
    : savedOrigin() || defaultOrigin(size);
  if (panel && !panel.isDestroyed()) {
    panel.setBounds({ x: origin.x, y: origin.y, width: size.width, height: size.height });
  }
}

function createPanel() {
  const size = windowSize();
  const origin = savedOrigin() || defaultOrigin(size);
  panel = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: origin.x,
    y: origin.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    thickFrame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.setIgnoreMouseEvents(true, { forward: true });
  panel.webContents.on('did-finish-load', onPageReady);
  panel.webContents.on('render-process-gone', () => {
    pageReady = false;
    log('web content ended; reloading');
    setTimeout(() => {
      if (panel && !panel.isDestroyed()) panel.reload();
    }, 500);
  });
  panel.on('closed', () => {
    panel = null;
    pageReady = false;
  });
  panel.once('ready-to-show', () => {
    if (panel && !panel.isDestroyed()) panel.showInactive();
  });
  panel.loadFile(path.join(webDir(), 'index.html'));
  log(`loading ${path.join(webDir(), 'index.html')}`);
}

function onPageReady() {
  pageReady = true;
  log('page loaded');
  pushOptions();
  setTimeout(reportStatus, 2000);
  if (!statusTimer) statusTimer = setInterval(reportStatus, 15000);
}

// MARK: Frame loop

function tick() {
  if (!panel || panel.isDestroyed() || !pageReady) return;
  const pointer = screen.getCursorScreenPoint();
  if (dragging && dragStart) {
    panel.setPosition(
      Math.round(dragStart.origin.x + pointer.x - dragStart.cursor.x),
      Math.round(dragStart.origin.y + pointer.y - dragStart.cursor.y),
    );
  }
  const bounds = panel.getBounds();
  const cursor = { x: Math.round(pointer.x - bounds.x), y: Math.round(pointer.y - bounds.y) };
  const calls = [];
  if (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y) {
    lastCursor = cursor;
    calls.push(`cat.cursor(${cursor.x},${cursor.y})`);
  }
  if (pendingDelta.x !== 0 || pendingDelta.y !== 0) {
    calls.push(`cat.mouseMove(${pendingDelta.x.toFixed(1)},${pendingDelta.y.toFixed(1)})`);
    pendingDelta = { x: 0, y: 0 };
  }
  if (calls.length) js(calls.join(';'));
}

// MARK: Input

function pointerInside() {
  if (!panel || panel.isDestroyed()) return false;
  const pointer = screen.getCursorScreenPoint();
  const bounds = panel.getBounds();
  return pointer.x >= bounds.x && pointer.x < bounds.x + bounds.width
    && pointer.y >= bounds.y && pointer.y < bounds.y + bounds.height;
}

function onKey(keycode, down) {
  keyEvents += 1;
  const code = KeyMap.code(keycode);
  if (!code) return;
  js(`cat.key('${code}',${down})`);
}

function startPet() {
  if (petting || !panel) return;
  petting = true;
  const bounds = panel.getBounds();
  const pointer = screen.getCursorScreenPoint();
  js(`cat.pet(true, ${Math.round(pointer.x - bounds.x)})`);
}

function stopPet() {
  if (!petting) return;
  petting = false;
  js('cat.pet(false, 0)');
}

function startDrag() {
  if (dragging || !panel) return;
  const bounds = panel.getBounds();
  dragStart = { cursor: screen.getCursorScreenPoint(), origin: { x: bounds.x, y: bounds.y } };
  dragging = true;
  panel.setIgnoreMouseEvents(false);
}

function stopDrag() {
  if (!dragging) return;
  dragging = false;
  dragStart = null;
  saveOrigin();
  if (panel && !panel.isDestroyed()) panel.setIgnoreMouseEvents(hit === 'none', { forward: true });
}

// libuiohook buttons: 1 = left, 2 = right, 3 = middle.
function onButton(button, down) {
  const inside = pointerInside();
  if (down) {
    if (inside && hit !== 'none') {
      if (button === 2) showContextMenu();
      else if (button === 1) {
        if (hit === 'pet') startPet();
        else startDrag();
      }
    }
  } else {
    stopPet();
    stopDrag();
  }
  js(`cat.mouseButton(${down})`);
}

function startInputHook() {
  let uiohook;
  try {
    uiohook = require('uiohook-napi');
  } catch (error) {
    log(`global input unavailable: ${error.message}`);
    return;
  }
  hook = uiohook.uIOhook;
  hook.on('keydown', event => {
    if (held.has(event.keycode)) return; // autorepeat: one paw press per physical press
    held.add(event.keycode);
    onKey(event.keycode, true);
  });
  hook.on('keyup', event => {
    held.delete(event.keycode);
    onKey(event.keycode, false);
  });
  hook.on('mousedown', event => onButton(event.button, true));
  hook.on('mouseup', event => onButton(event.button, false));
  hook.on('wheel', event => {
    // Normalise 120-unit deltas to one notch, then feed it like a vertical mouse move.
    const clicks = Math.abs(event.rotation) > 10 ? event.rotation / 120 : event.rotation;
    if (event.direction === 3) pendingDelta.y += -clicks * 0.4;
  });
  try {
    hook.start();
    hookReady = true;
    log('global input hook started');
  } catch (error) {
    log(`global input hook failed: ${error.message}`);
  }
}

// MARK: Menu

function radios(key, getter, options) {
  return options.map(([label, value]) => ({
    label,
    type: 'radio',
    checked: getter() === value,
    click: () => {
      store.set(key, value);
      pushOptions();
      rebuildMenu();
    },
  }));
}

function updateItem() {
  if (!app.isPackaged) return { label: `开发模式 v${app.getVersion()}`, enabled: false };
  switch (update.state) {
    case 'ready':
      return { label: `重启并更新到 v${update.version}`, click: () => setImmediate(() => autoUpdater.quitAndInstall()) };
    case 'downloading':
      return { label: `正在下载更新 ${update.percent}%`, enabled: false };
    case 'checking':
      return { label: '正在检查更新…', enabled: false };
    case 'current':
      return { label: `已是最新版本 v${app.getVersion()}`, enabled: false };
    case 'error':
      return { label: '检查更新失败，点击重试', click: checkForUpdates };
    default:
      return { label: '检查更新…', click: checkForUpdates };
  }
}

function autoLaunchItem() {
  if (!app.isPackaged) return { label: '开机自启（开发模式不可用）', enabled: false };
  let enabled = false;
  try {
    enabled = app.getLoginItemSettings().openAtLogin;
  } catch {
    // Ignore: unavailable on this platform.
  }
  return {
    label: '开机自启',
    type: 'checkbox',
    checked: enabled,
    click: item => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }),
  };
}

function buildTemplate() {
  const template = [
    {
      label: '立体效果（3D）',
      type: 'checkbox',
      checked: getStyle() === '3d',
      click: () => {
        store.set('style', getStyle() === '3d' ? '2d' : '3d');
        pushOptions();
        rebuildMenu();
      },
    },
    {
      label: '毛色',
      submenu: radios('coat', getCoat, [
        ['黑猫', 'black'], ['奶牛猫', 'tuxedo'], ['橘猫', 'orange'],
        ['蓝灰猫', 'grey'], ['白猫', 'white'], ['三花猫', 'calico'],
      ]),
    },
  ];
  if (getCoat() === 'orange' || getCoat() === 'grey') {
    const striped = getPattern() === 'tabby' || (getPattern() === 'auto' && getCoat() === 'orange');
    template.push({
      label: '花纹',
      submenu: [
        {
          label: '纯色', type: 'radio', checked: !striped,
          click: () => {
            store.set(`pattern.${getCoat()}`, 'solid');
            pushOptions();
            rebuildMenu();
          },
        },
        {
          label: '虎斑条纹', type: 'radio', checked: striped,
          click: () => {
            store.set(`pattern.${getCoat()}`, 'tabby');
            pushOptions();
            rebuildMenu();
          },
        },
      ],
    });
  }
  template.push({
    label: '外观',
    submenu: [
      {
        label: '眼睛颜色',
        submenu: radios('eyeColor', getEyeColor, [
          ['跟随毛色', 'auto'], ['金色', 'gold'], ['绿色', 'green'],
          ['蓝色', 'blue'], ['琥珀色', 'amber'], ['鸳鸯眼（一蓝一金）', 'odd'],
        ]),
      },
      {
        label: '眼睛高光',
        submenu: radios('eyeShine', getEyeShine, [['无', 'none'], ['经典', 'classic'], ['闪亮', 'sparkle']]),
      },
      {
        label: '项圈',
        submenu: radios('collar', getCollar, [
          ['无', 'none'], ['红色铃铛', 'red'], ['蓝色铃铛', 'blue'],
          ['粉色铃铛', 'pink'], ['绿色铃铛', 'green'],
        ]),
      },
      {
        label: '腮红',
        type: 'checkbox',
        checked: getBlush(),
        click: () => {
          store.set('blush', !getBlush());
          pushOptions();
          rebuildMenu();
        },
      },
      {
        label: '胡须',
        type: 'checkbox',
        checked: getWhiskers(),
        click: () => {
          store.set('whiskers', !getWhiskers());
          pushOptions();
          rebuildMenu();
        },
      },
    ],
  });
  template.push({
    label: '大小',
    submenu: [['小', 0.7], ['中', 0.9], ['大', 1.1], ['特大', 1.35]].map(([label, value]) => ({
      label,
      type: 'radio',
      checked: Math.abs(getScale() - value) < 0.001,
      click: () => {
        applyScale(value, true);
        rebuildMenu();
      },
    })),
  });
  template.push({
    label: '多久睡着',
    submenu: [
      ['30 秒', 30], ['1 分钟', 60], ['3 分钟', 180], ['10 分钟', 600], ['不睡', 0],
    ].map(([label, value]) => ({
      label,
      type: 'radio',
      checked: getSleepAfter() === value,
      click: () => {
        store.set('sleepAfter', value);
        pushOptions();
        rebuildMenu();
      },
    })),
  });
  template.push({
    label: '隐私模式（不显示键名）',
    type: 'checkbox',
    checked: getPrivacy(),
    click: () => {
      store.set('privacy', !getPrivacy());
      pushOptions();
      rebuildMenu();
    },
  });
  template.push({ label: '调节反应…', click: openSettings });
  template.push({ type: 'separator' });
  template.push(autoLaunchItem());
  template.push({
    label: '回到右下角',
    click: () => {
      store.remove('originX');
      store.remove('originY');
      applyScale(getScale(), false);
    },
  });
  template.push({
    label: panel && panel.isVisible() ? '隐藏' : '显示',
    click: () => {
      if (!panel || panel.isDestroyed()) return;
      if (panel.isVisible()) panel.hide();
      else panel.showInactive();
      rebuildMenu();
    },
  });
  template.push({ type: 'separator' });
  template.push(updateItem());
  if (app.isPackaged && !hookReady) template.push({ label: '键盘监听未启动（详见 log.txt）', enabled: false });
  template.push({ type: 'separator' });
  template.push({ label: '退出 KeyCat', click: () => app.quit() });
  return template;
}

function rebuildMenu() {
  if (!tray || tray.isDestroyed()) return null;
  const menu = Menu.buildFromTemplate(buildTemplate());
  tray.setContextMenu(menu);
  return menu;
}

function showContextMenu() {
  if (!panel || panel.isDestroyed()) return;
  const menu = Menu.buildFromTemplate(buildTemplate());
  menu.popup({ window: panel });
}

// MARK: Settings window

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workAreaSize;
  settingsWin = new BrowserWindow({
    width: 420,
    height: Math.min(860, area.height - 60),
    title: 'KeyCat 调节',
    resizable: false,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(webDir(), 'settings.html'));
  settingsWin.webContents.on('did-finish-load', () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    settingsWin.webContents.executeJavaScript(`initTune(${JSON.stringify(getTune())})`).catch(() => {});
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

ipcMain.on('cat:message', (event, message) => {
  if (!panel || panel.isDestroyed() || event.sender !== panel.webContents) return;
  if (!message || typeof message.hit !== 'string') return;
  hit = message.hit;
  if (!dragging) panel.setIgnoreMouseEvents(hit === 'none', { forward: true });
});

ipcMain.on('settings:message', (event, body) => {
  if (!settingsWin || settingsWin.isDestroyed() || event.sender !== settingsWin.webContents) return;
  if (!body || typeof body !== 'object') return;
  if (body.tune && typeof body.tune === 'object') {
    store.set('tune', { ...getTune(), ...body.tune });
    pushOptions();
  } else if (body.reset) {
    store.set('tune', {});
    pushOptions();
  } else if (typeof body.test === 'string') {
    js(body.test === 'annoy' ? 'cat.annoyNow()' : 'cat.curiousNow(3)');
  }
});

// MARK: Status & updates

function reportStatus() {
  if (!pageReady || !panel || panel.isDestroyed()) return;
  panel.webContents.executeJavaScript('cat.state.ticks = 0; 1').catch(() => {});
  setTimeout(async () => {
    try {
      const ticks = await panel.webContents.executeJavaScript('cat.state.ticks');
      const line = `${new Date().toISOString()} keyboard=${hookReady ? 'active' : 'missing'} `
        + `keyEvents=${keyEvents} fps=${Math.round(Number(ticks) || 0)}\n`;
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(path.join(dataDir(), 'status.txt'), line);
    } catch {
      // The window may have been reloaded mid-probe.
    }
  }, 1000);
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  update.state = 'checking';
  rebuildMenu();
  autoUpdater.checkForUpdates().catch(error => {
    update.state = 'error';
    log(`update check failed: ${error && error.message}`);
    rebuildMenu();
  });
}

function setupUpdater() {
  if (!app.isPackaged) {
    update.state = 'dev';
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    update.state = 'checking';
    rebuildMenu();
  });
  autoUpdater.on('update-available', info => {
    update.state = 'downloading';
    update.version = info.version;
    update.percent = 0;
    log(`update ${info.version} available`);
    rebuildMenu();
  });
  autoUpdater.on('download-progress', progress => {
    update.percent = Math.round(progress.percent || 0);
    rebuildMenu();
  });
  autoUpdater.on('update-downloaded', info => {
    update.state = 'ready';
    update.version = info.version;
    update.percent = 100;
    log(`update ${info.version} downloaded`);
    rebuildMenu();
    if (tray && !tray.isDestroyed() && process.platform === 'win32') {
      tray.displayBalloon({
        title: 'KeyCat 更新已就绪',
        content: `v${info.version} 将在退出后自动安装，也可以从托盘菜单立即重启更新。`,
      });
    }
  });
  autoUpdater.on('update-not-available', () => {
    update.state = 'current';
    rebuildMenu();
  });
  autoUpdater.on('error', error => {
    update.state = 'error';
    log(`updater error: ${error && error.message}`);
    rebuildMenu();
  });
  setTimeout(checkForUpdates, 15000);
  updateTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

// MARK: Tray & lifecycle

function createTray() {
  let icon = nativeImage.createFromPath(asset('tray.png'));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('KeyCat');
  if (!isMac) {
    // Right-click opens the menu through setContextMenu; left-click should do the same.
    tray.on('click', () => {
      const menu = rebuildMenu();
      if (menu) tray.popUpContextMenu(menu);
    });
  }
  rebuildMenu();
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.ellobok.keycat');
  if (isMac && app.dock) app.dock.hide();
  Menu.setApplicationMenu(null);
  store = new Store(path.join(dataDir(), 'settings.json'));
  createPanel();
  createTray();
  startInputHook();
  // The first menu was built before the hook came up; rebuild so a failed hook is visible.
  rebuildMenu();
  tickTimer = setInterval(tick, 16);
  setupUpdater();
  log('started');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panel && !panel.isDestroyed()) panel.showInactive();
  });
  app.on('window-all-closed', () => {
    // The app lives in the tray; closing windows must not quit it.
  });
  app.on('before-quit', () => {
    clearInterval(tickTimer);
    clearInterval(statusTimer);
    clearInterval(updateTimer);
    try {
      if (hook) hook.stop();
    } catch {
      // The hook may already be gone.
    }
  });
  app.whenReady().then(start);
}

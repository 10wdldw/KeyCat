(() => {
  const post = message => window.__TAURI_INTERNALS__.invoke('host_message', {
    channel: 'linuxPanel', message,
  }).catch(() => {});

  // XWayland cannot follow the pointer over native Wayland surfaces. Publish the
  // visible cat as a GTK input region so it can receive the first pointer event.
  const mask = document.createElement('canvas');
  const context = mask.getContext('2d', { willReadFrequently: true });
  let lastSample = -Infinity;
  let lastWidth = 0, lastHeight = 0;
  let lastRegion = '';
  window.keyCatLinuxInputRegion = canvas => {
    const width = window.innerWidth, height = window.innerHeight;
    const time = performance.now();
    if (!width || !height) return;
    if (width === lastWidth && height === lastHeight && time - lastSample < 100) return;
    lastWidth = width;
    lastHeight = height;
    lastSample = time;
    const columns = Math.ceil(width / 4), rows = Math.ceil(height / 4);
    if (mask.width !== columns || mask.height !== rows) {
      mask.width = columns;
      mask.height = rows;
    }
    context.clearRect(0, 0, columns, rows);
    context.drawImage(canvas, 0, 0, columns, rows);
    const { data } = context.getImageData(0, 0, columns, rows);
    const rectangles = [];
    for (let row = 0; row < rows; row++) {
      let start = -1;
      for (let column = 0; column <= columns; column++) {
        const opaque = column < columns && data[4 * (row * columns + column) + 3] >= 64;
        if (opaque) {
          if (start < 0) start = column;
        } else if (start >= 0) {
          const x = Math.floor(start * width / columns);
          const y = Math.floor(row * height / rows);
          const right = Math.floor(column * width / columns);
          const bottom = Math.floor((row + 1) * height / rows);
          rectangles.push([x, y, right - x, bottom - y]);
          start = -1;
        }
      }
    }
    const region = rectangles.join(';');
    if (region !== lastRegion) {
      lastRegion = region;
      post({ rectangles });
    }
  };

  const position = ({ screenX, screenY }) => ({ screenX, screenY });
  let pointer = null;
  let dragging = false;
  let pendingMove = null;
  let moveFrame = 0;
  window.addEventListener('pointerdown', event => {
    if (!event.isPrimary || pointer !== null || !window.cat) return;
    if (event.button === 2) {
      event.preventDefault();
      post({ action: 'menu' });
    } else if (event.button === 0) {
      pointer = event.pointerId;
      dragging = window.cat.hitTest(event.clientX, event.clientY) !== 'pet';
      event.target.setPointerCapture(pointer);
      event.preventDefault();
      post({ action: dragging ? 'drag' : 'pet', ...position(event) });
    }
  });
  window.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer || !dragging) return;
    pendingMove = position(event);
    if (!moveFrame) {
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        post({ action: 'move', ...pendingMove });
      });
    }
  });
  const finish = event => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    dragging = false;
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    pendingMove = null;
    post({ action: 'release', ...(event.type === 'pointerup' ? position(event) : {}) });
  };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('lostpointercapture', finish);
})();

'use strict';
// The web scene talks to its host through `window.webkit.messageHandlers.<name>.postMessage`,
// the WKWebView bridge the mac build uses. Recreate that shape on top of IPC so web/ stays
// untouched.
const { contextBridge, ipcRenderer } = require('electron');

const handler = channel => ({
  postMessage: message => ipcRenderer.send(channel, message),
});

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    cat: handler('cat:message'),
    settings: handler('settings:message'),
  },
});

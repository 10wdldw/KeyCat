'use strict';
// A tiny JSON-backed settings store. Keys mirror the mac build's UserDefaults names so the two
// versions are easy to compare: catScale, coat, pattern.<coat>, eyeColor, eyeShine, blush,
// whiskers, collar, privacy, sleepAfter, tune, originX, originY.
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      this.data = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('settings save failed:', error.message);
    }
  }

  get(key, fallback) {
    const value = this.data[key];
    return value === undefined || value === null ? fallback : value;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  remove(key) {
    delete this.data[key];
    this.save();
  }
}

module.exports = Store;

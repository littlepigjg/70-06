const fs = require('fs');
const path = require('path');
const config = require('../config');

class StateCache {
  constructor() {
    this.shares = new Map();
    this.downloading = new Set();
    this.dirty = false;
    this.pendingLogs = [];
    this.initialized = false;
    this.flushInterval = null;
  }

  init() {
    if (this.initialized) return;

    try {
      if (fs.existsSync(config.SHARES_FILE)) {
        const data = fs.readFileSync(config.SHARES_FILE, 'utf8');
        const shares = JSON.parse(data);
        for (const share of shares) {
          this.shares.set(share.code, share);
        }
        console.log(`[StateCache] 已加载 ${this.shares.size} 条分享记录`);
      }
    } catch (err) {
      console.error('[StateCache] 加载数据失败:', err.message);
    }

    this.flushInterval = setInterval(() => {
      this.flush();
    }, 1000);

    this.initialized = true;
  }

  getAllShares() {
    return Array.from(this.shares.values());
  }

  getShareByCode(code) {
    return this.shares.get(code) || null;
  }

  hasShare(code) {
    return this.shares.has(code);
  }

  addShare(share) {
    this.shares.set(share.code, { ...share });
    this.dirty = true;
    return this.shares.get(share.code);
  }

  updateShare(code, updates) {
    const share = this.shares.get(code);
    if (!share) return null;
    const updated = { ...share, ...updates };
    this.shares.set(code, updated);
    this.dirty = true;
    return updated;
  }

  atomicUpdateShare(code, updateFn) {
    const share = this.shares.get(code);
    if (!share) return null;
    const updates = updateFn(share);
    if (updates === null || updates === undefined) return null;
    return this.updateShare(code, updates);
  }

  deleteShare(code) {
    const deleted = this.shares.delete(code);
    if (deleted) this.dirty = true;
    return deleted;
  }

  startDownload(code) {
    this.downloading.add(code);
  }

  endDownload(code) {
    this.downloading.delete(code);
  }

  isDownloading(code) {
    return this.downloading.has(code);
  }

  getDownloadingCount() {
    return this.downloading.size;
  }

  appendLog(logEntry) {
    this.pendingLogs.push(logEntry);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;

    try {
      if (this.pendingLogs.length > 0) {
        const logLines = this.pendingLogs.map(e => JSON.stringify(e) + '\n').join('');
        fs.appendFileSync(config.DOWNLOAD_LOG_FILE, logLines);
        this.pendingLogs = [];
      }

      const shares = Array.from(this.shares.values());
      const tmpFile = config.SHARES_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(shares, null, 2));
      fs.renameSync(tmpFile, config.SHARES_FILE);

      this.dirty = false;
    } catch (err) {
      console.error('[StateCache] 持久化失败:', err.message);
    }
  }

  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    this.initialized = false;
  }

  getStats() {
    let active = 0, expired = 0, pending = 0, deleted = 0, downloading = this.downloading.size;
    let totalSize = 0;
    const now = Date.now();

    for (const share of this.shares.values()) {
      if (share.status === 'active') {
        if (share.expiryTime < now) {
          expired++;
        } else {
          active++;
          totalSize += share.size;
        }
      } else if (share.status === 'pending_delete' || share.status === 'download_limit_reached') {
        pending++;
      } else {
        deleted++;
      }
    }

    return {
      total: this.shares.size,
      active,
      downloading,
      expired,
      readyForCleanup: pending,
      deleted,
      totalActiveSize: totalSize
    };
  }
}

const stateCache = new StateCache();

module.exports = stateCache;

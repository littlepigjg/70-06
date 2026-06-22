const fs = require('fs');
const path = require('path');
const config = require('../config');
const stateCache = require('./stateCache');

class DataStore {
  static init() {
    stateCache.init();
  }

  static readShares() {
    return stateCache.getAllShares();
  }

  static writeShares(shares) {
    for (const share of shares) {
      stateCache.shares.set(share.code, share);
    }
    stateCache.dirty = true;
    stateCache.flush();
  }

  static addShare(share, tx) {
    const result = stateCache.addShare(share);
    
    if (tx) {
      const originalShare = stateCache.getShareByCode(share.code);
      tx.addOperation(
        async () => result,
        async () => stateCache.deleteShare(share.code)
      );
    }
    
    return result;
  }

  static updateShare(code, updates, tx) {
    const original = stateCache.getShareByCode(code);
    if (!original) return null;
    
    const result = stateCache.updateShare(code, updates);
    
    if (tx) {
      const snapshot = { ...original };
      tx.addOperation(
        async () => result,
        async () => stateCache.updateShare(code, snapshot)
      );
    }
    
    return result;
  }

  static atomicUpdateShare(code, updateFn, tx) {
    const original = stateCache.getShareByCode(code);
    if (!original) return null;
    
    const updates = updateFn(original);
    if (updates === null || updates === undefined) return null;
    
    return this.updateShare(code, updates, tx);
  }

  static getShareByCode(code) {
    return stateCache.getShareByCode(code);
  }

  static deleteShare(code, tx) {
    const original = stateCache.getShareByCode(code);
    if (!original) return false;
    
    const result = stateCache.deleteShare(code);
    
    if (tx) {
      const snapshot = { ...original };
      tx.addOperation(
        async () => result,
        async () => stateCache.addShare(snapshot)
      );
    }
    
    return result;
  }

  static getAllShares() {
    return stateCache.getAllShares();
  }

  static logDownload(share, ip, userAgent, tx) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      code: share.code,
      filename: share.filename,
      originalName: share.originalName,
      ip: ip,
      userAgent: userAgent
    };

    stateCache.appendLog(logEntry);
    
    if (tx) {
      tx.addOperation(
        async () => logEntry,
        async () => {}
      );
    }

    return logEntry;
  }

  static getDownloadLogs() {
    try {
      if (fs.existsSync(config.DOWNLOAD_LOG_FILE)) {
        const data = fs.readFileSync(config.DOWNLOAD_LOG_FILE, 'utf8');
        return data.trim().split('\n').filter(line => line).map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean);
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  static getSharesByStatus(status) {
    return stateCache.getAllShares().filter(s => s.status === status);
  }

  static getExpiredShares() {
    const now = Date.now();
    return stateCache.getAllShares().filter(s => s.expiryTime && s.expiryTime < now);
  }

  static flush() {
    stateCache.flush();
  }

  static shutdown() {
    stateCache.shutdown();
  }

  static isDownloading(code) {
    return stateCache.isDownloading(code);
  }

  static startDownload(code) {
    stateCache.startDownload(code);
  }

  static endDownload(code) {
    stateCache.endDownload(code);
  }

  static getDownloadingCount() {
    return stateCache.getDownloadingCount();
  }

  static getStats() {
    return stateCache.getStats();
  }
}

module.exports = DataStore;

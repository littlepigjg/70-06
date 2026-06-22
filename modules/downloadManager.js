const fs = require('fs');
const path = require('path');
const config = require('../config');
const DataStore = require('./dataStore');
const ExpiryChecker = require('./expiryChecker');
const lockManager = require('./lockManager');
const transactionManager = require('./transactionManager');

class DownloadManager {
  static async startDownload(code, ip, userAgent) {
    const lockKey = `download:${code}`;
    const lockHandle = await lockManager.acquire(lockKey);

    try {
      const result = await transactionManager.run(async (tx) => {
        const share = DataStore.getShareByCode(code);
        if (!share) {
          throw new Error('提取码不存在');
        }

        const validation = ExpiryChecker.isShareValid(share);
        if (!validation.valid) {
          const reasons = {
            expired: '文件已过期',
            download_limit: '下载次数已用完',
            inactive: '分享已失效',
            not_found: '提取码不存在'
          };
          throw new Error(reasons[validation.reason] || '无法下载');
        }

        const filePath = path.join(config.UPLOAD_DIR, share.filename);
        if (!fs.existsSync(filePath)) {
          DataStore.updateShare(code, { status: 'file_missing' }, tx);
          throw new Error('文件不存在');
        }

        DataStore.logDownload(share, ip, userAgent, tx);

        const newDownloadCount = share.downloadCount + 1;
        const updates = {
          downloadCount: newDownloadCount,
          status: 'downloading'
        };

        if (share.maxDownloads !== -1 && newDownloadCount >= share.maxDownloads) {
          updates.reachedLimitAt = Date.now();
        }

        DataStore.updateShare(code, updates, tx);
        DataStore.startDownload(code);

        return {
          filePath,
          originalName: share.originalName,
          mimetype: share.mimetype,
          size: share.size,
          share: { ...share, ...updates },
          willReachLimit: share.maxDownloads !== -1 && newDownloadCount >= share.maxDownloads
        };
      });

      return {
        ...result,
        lockHandle,
        releaseLock: () => {
          DataStore.endDownload(code);
          lockHandle.release();
        }
      };

    } catch (err) {
      DataStore.endDownload(code);
      lockHandle.release();
      throw err;
    }
  }

  static async finalizeDownload(code, success, willReachLimit) {
    const lockKey = `download:${code}`;

    return lockManager.withLock(lockKey, async () => {
      return transactionManager.run(async (tx) => {
        const share = DataStore.getShareByCode(code);
        if (!share) return null;

        if (!success) {
          if (share.status === 'downloading') {
            const newDownloadCount = Math.max(0, share.downloadCount - 1);
            DataStore.updateShare(code, {
              downloadCount: newDownloadCount,
              status: 'active',
              reachedLimitAt: null
            }, tx);
            console.log(`[${new Date().toLocaleString()}] 分享 ${code} 下载失败，回滚次数到 ${newDownloadCount}`);
          }
          return DataStore.getShareByCode(code);
        }

        if (success && share.status === 'downloading') {
          const now = Date.now();
          const updates = {
            completedAt: now
          };

          if (willReachLimit || ExpiryChecker.isDownloadLimitReached(share)) {
            updates.status = 'ready_for_cleanup';
            updates.readyAt = now;
            console.log(`[${new Date().toLocaleString()}] 分享 ${code} 下载完成，次数已满，标记为可清理`);
          } else {
            updates.status = 'active';
            console.log(`[${new Date().toLocaleString()}] 分享 ${code} 下载完成，还有剩余次数`);
          }

          DataStore.updateShare(code, updates, tx);
          return DataStore.getShareByCode(code);
        }

        return share;
      });
    });
  }

  static async canDownload(code) {
    const share = DataStore.getShareByCode(code);
    if (!share) return { canDownload: false, reason: 'not_found' };

    if (ExpiryChecker.isDownloadLimitReached(share)) {
      return { canDownload: false, reason: 'download_limit' };
    }

    if (DataStore.isDownloading(code)) {
      return { canDownload: false, reason: 'downloading' };
    }

    const validation = ExpiryChecker.isShareValid(share);
    return {
      canDownload: validation.valid,
      reason: validation.reason
    };
  }

  static getActiveDownloadCount() {
    return DataStore.getDownloadingCount();
  }

  static getActiveDownloads() {
    const result = [];
    for (const info of lockManager.getLockedKeys()) {
      if (info.key.startsWith('download:')) {
        result.push({
          code: info.key.replace('download:', ''),
          waiting: info.waiting
        });
      }
    }
    return result;
  }
}

module.exports = DownloadManager;

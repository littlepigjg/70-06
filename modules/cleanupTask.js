const fs = require('fs');
const path = require('path');
const config = require('../config');
const DataStore = require('./dataStore');
const ExpiryChecker = require('./expiryChecker');
const lockManager = require('./lockManager');

const MIN_DOWNLOAD_DURATION_MS = 30 * 1000;

class CleanupTask {
  static canSafelyDelete(share) {
    if (share.status === 'deleted' || share.status === 'file_missing' || share.status === 'deleted_by_admin') {
      return { canDelete: false, reason: 'already_deleted' };
    }

    if (DataStore.isDownloading(share.code)) {
      return { canDelete: false, reason: 'downloading' };
    }

    if (lockManager.isLocked(`download:${share.code}`)) {
      return { canDelete: false, reason: 'locked' };
    }

    if (share.reachedLimitAt && (Date.now() - share.reachedLimitAt) < MIN_DOWNLOAD_DURATION_MS) {
      return { canDelete: false, reason: 'too_soon_after_limit' };
    }

    if (share.status === 'downloading' && !share.readyAt) {
      if (share.reachedLimitAt) {
        const elapsed = Date.now() - share.reachedLimitAt;
        if (elapsed < MIN_DOWNLOAD_DURATION_MS) {
          return { canDelete: false, reason: 'pending_download_complete' };
        }
      }
    }

    if (share.status === 'ready_for_cleanup') {
      if (share.readyAt && (Date.now() - share.readyAt) < 5000) {
        return { canDelete: false, reason: 'cooling_down' };
      }
      return { canDelete: true, reason: 'ready' };
    }

    if (share.status === 'download_limit_reached') {
      return { canDelete: true, reason: 'limit_reached' };
    }

    if (ExpiryChecker.canCleanup(share)) {
      return { canDelete: true, reason: 'can_cleanup' };
    }

    return { canDelete: false, reason: 'not_ready' };
  }

  static async deleteShareFile(share) {
    return lockManager.withLock(`download:${share.code}`, async () => {
      if (DataStore.isDownloading(share.code)) {
        throw new Error('文件正在下载中');
      }

      const filePath = path.join(config.UPLOAD_DIR, share.filename);
      let fileDeleted = false;

      if (fs.existsSync(filePath)) {
        try {
          fs.accessSync(filePath, fs.constants.W_OK);
          fs.unlinkSync(filePath);
          fileDeleted = true;
          console.log(`  ✓ 已删除文件: ${share.originalName} (${share.code}) [${formatSize(share.size)}]`);
        } catch (err) {
          console.error(`  ✗ 删除文件失败 (可能被占用): ${share.originalName} (${share.code}) - ${err.message}`);
          return false;
        }
      } else {
        console.log(`  ℹ 文件已不存在: ${share.originalName} (${share.code})`);
      }

      DataStore.updateShare(share.code, {
        status: 'deleted',
        deletedAt: Date.now(),
        fileDeleted: fileDeleted
      });
      DataStore.flush();

      return fileDeleted;
    });
  }

  static async cleanupExpiredShares() {
    const runId = Date.now();
    console.log(`[${new Date().toLocaleString()}] [清理 #${runId}] 开始扫描...`);

    const shares = DataStore.getAllShares();
    let cleanedCount = 0;
    let skippedCount = 0;
    let downloadingCount = 0;
    let protectedCount = 0;

    for (const share of shares) {
      const check = this.canSafelyDelete(share);

      if (!check.canDelete) {
        skippedCount++;
        if (check.reason === 'downloading' || check.reason === 'locked') {
          downloadingCount++;
        }
        if (check.reason === 'too_soon_after_limit' || check.reason === 'cooling_down' || check.reason === 'pending_download_complete') {
          protectedCount++;
        }
        continue;
      }

      try {
        const deleted = await this.deleteShareFile(share);
        if (deleted !== false) {
          cleanedCount++;
        } else {
          skippedCount++;
        }
      } catch (err) {
        skippedCount++;
        console.error(`  ✗ 删除失败: ${share.originalName} (${share.code}) - ${err.message}`);
      }
    }

    console.log(`[${new Date().toLocaleString()}] [清理 #${runId}] 完成: 删除=${cleanedCount}, 跳过=${skippedCount} (下载中=${downloadingCount}, 保护中=${protectedCount}), 总计=${shares.length}`);
    return { cleanedCount, skippedCount, downloadingCount, protectedCount, totalCount: shares.length, runId };
  }

  static start() {
    console.log(`清理任务已启动，间隔 ${config.CLEANUP_INTERVAL / 1000} 秒 (最小保护时间 ${MIN_DOWNLOAD_DURATION_MS / 1000}秒)`);

    setInterval(() => {
      this.cleanupExpiredShares().catch(err => {
        console.error('清理任务执行出错:', err);
      });
    }, config.CLEANUP_INTERVAL);

    setTimeout(() => {
      this.cleanupExpiredShares().catch(err => {
        console.error('初始清理执行出错:', err);
      });
    }, 10000);
  }

  static async forceCleanup() {
    return this.cleanupExpiredShares();
  }

  static async forceDeleteShare(code) {
    return lockManager.withLock(`download:${code}`, async () => {
      const share = DataStore.getShareByCode(code);
      if (!share) {
        throw new Error('分享不存在');
      }

      if (DataStore.isDownloading(code)) {
        throw new Error('该文件正在下载中，请稍后再试');
      }

      return this.deleteShareFile(share);
    });
  }

  static getStats() {
    return DataStore.getStats();
  }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = CleanupTask;

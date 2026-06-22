const DataStore = require('./dataStore');

const STATUS_MAP = {
  active: '正常',
  downloading: '下载中',
  ready_for_cleanup: '已用完',
  download_limit_reached: '已用完',
  expired: '已过期',
  deleted: '已删除',
  deleted_by_admin: '已删除',
  file_missing: '文件缺失'
};

class ExpiryChecker {
  static isExpired(share) {
    if (!share.expiryTime) return false;
    return Date.now() > share.expiryTime;
  }

  static isDownloadLimitReached(share) {
    if (!share.maxDownloads || share.maxDownloads === -1) return false;
    return share.downloadCount >= share.maxDownloads;
  }

  static isShareValid(share) {
    if (!share) return { valid: false, reason: 'not_found' };

    if (this.isExpired(share)) {
      return { valid: false, reason: 'expired' };
    }

    if (this.isDownloadLimitReached(share)) {
      return { valid: false, reason: 'download_limit' };
    }

    if (share.status === 'file_missing' ||
        share.status === 'deleted' ||
        share.status === 'deleted_by_admin' ||
        share.status === 'ready_for_cleanup') {
      return { valid: false, reason: 'inactive' };
    }

    return { valid: true };
  }

  static canCleanup(share) {
    if (share.status === 'ready_for_cleanup') return true;
    if (share.status === 'download_limit_reached') return true;

    if (share.status === 'active' || share.status === 'downloading') {
      if (this.isExpired(share)) return true;
    }

    return false;
  }

  static isDownloading(share) {
    return share.status === 'downloading';
  }

  static checkAndUpdateShare(code) {
    const share = DataStore.getShareByCode(code);
    const validation = this.isShareValid(share);

    if (!validation.valid) {
      return { valid: false, reason: validation.reason, share };
    }

    return { valid: true, share };
  }

  static getExpiredShares() {
    const shares = DataStore.getAllShares();
    return shares.filter(s =>
      (s.status === 'active' || s.status === 'download_limit_reached' || s.status === 'downloading') &&
      (this.isExpired(s) || this.isDownloadLimitReached(s))
    );
  }

  static getShareStatus(share) {
    if (this.isExpired(share)) return '已过期';

    if (share.status === 'downloading') {
      if (this.isDownloadLimitReached(share)) return '下载中';
      return '下载中';
    }

    if (this.isDownloadLimitReached(share)) {
      if (share.status === 'ready_for_cleanup' || share.status === 'download_limit_reached') {
        return '已用完';
      }
    }

    return STATUS_MAP[share.status] || '未知';
  }

  static getShareStatusBadge(share) {
    const status = this.getShareStatus(share);

    if (status === '正常') return { text: status, class: 'status-active' };
    if (status === '下载中') return { text: status, class: 'status-active' };
    if (status === '已过期') return { text: status, class: 'status-expired' };
    if (status === '已用完') return { text: status, class: 'status-limit' };
    return { text: status, class: 'status-deleted' };
  }
}

module.exports = ExpiryChecker;

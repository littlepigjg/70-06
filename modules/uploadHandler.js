const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const CodeManager = require('./codeManager');
const DataStore = require('./dataStore');
const ExpiryChecker = require('./expiryChecker');
const DownloadManager = require('./downloadManager');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE
  }
});

class UploadHandler {
  static getUploadMiddleware() {
    return upload.single('file');
  }

  static async createShare(file, options = {}) {
    const {
      maxDownloads = config.DEFAULT_MAX_DOWNLOADS,
      expiryHours = config.DEFAULT_EXPIRY_HOURS,
      customCode = null
    } = options;

    let code;
    if (customCode) {
      const validation = CodeManager.validateCode(customCode);
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      if (DataStore.getShareByCode(validation.code)) {
        throw new Error('该提取码已被使用');
      }
      code = validation.code;
    } else {
      code = CodeManager.generateUniqueCode();
    }

    const expiryTime = Date.now() + (expiryHours * 60 * 60 * 1000);

    const share = {
      id: uuidv4(),
      code: code,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      uploadTime: Date.now(),
      expiryTime: expiryTime,
      maxDownloads: parseInt(maxDownloads),
      downloadCount: 0,
      status: 'active',
      ip: null
    };

    DataStore.addShare(share);
    DataStore.flush();

    return {
      code: code,
      originalName: share.originalName,
      size: share.size,
      expiryTime: share.expiryTime,
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      uploadTime: share.uploadTime
    };
  }

  static async startDownload(code, ip, userAgent) {
    return DownloadManager.startDownload(code, ip, userAgent);
  }

  static async finalizeDownload(code, success, willReachLimit) {
    return DownloadManager.finalizeDownload(code, success, willReachLimit);
  }

  static getShareInfo(code) {
    const verification = CodeManager.verifyCode(code);
    if (!verification.success) {
      throw new Error(verification.message);
    }

    const share = verification.share;
    const check = ExpiryChecker.isShareValid(share);
    const isCurrentlyDownloading = DataStore.isDownloading(code);

    return {
      code: share.code,
      originalName: share.originalName,
      size: share.size,
      uploadTime: share.uploadTime,
      expiryTime: share.expiryTime,
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      status: ExpiryChecker.getShareStatus(share),
      canDownload: check.valid && !isCurrentlyDownloading
    };
  }
}

module.exports = UploadHandler;

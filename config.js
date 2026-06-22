const path = require('path');

module.exports = {
  PORT: 3000,
  UPLOAD_DIR: path.join(__dirname, 'uploads'),
  DATA_DIR: path.join(__dirname, 'data'),
  SHARES_FILE: path.join(__dirname, 'data', 'shares.json'),
  DOWNLOAD_LOG_FILE: path.join(__dirname, 'data', 'downloads.log'),
  MAX_FILE_SIZE: 1024 * 1024 * 1024,
  CLEANUP_INTERVAL: 60 * 1000,
  DEFAULT_EXPIRY_HOURS: 24,
  DEFAULT_MAX_DOWNLOADS: 10
};

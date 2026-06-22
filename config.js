const path = require('path');

module.exports = {
  PORT: 3000,
  UPLOAD_DIR: path.join(__dirname, 'uploads'),
  CHUNK_DIR: path.join(__dirname, 'uploads', 'chunks'),
  DATA_DIR: path.join(__dirname, 'data'),
  SHARES_FILE: path.join(__dirname, 'data', 'shares.json'),
  CHUNK_STATE_FILE: path.join(__dirname, 'data', 'chunks.json'),
  DOWNLOAD_LOG_FILE: path.join(__dirname, 'data', 'downloads.log'),
  MAX_FILE_SIZE: 1024 * 1024 * 1024,
  CHUNK_THRESHOLD: 100 * 1024 * 1024,
  CHUNK_SIZE: 5 * 1024 * 1024,
  CHUNK_TIMEOUT: 2 * 60 * 60 * 1000,
  CLEANUP_INTERVAL: 60 * 1000,
  DEFAULT_EXPIRY_HOURS: 24,
  DEFAULT_MAX_DOWNLOADS: 10
};

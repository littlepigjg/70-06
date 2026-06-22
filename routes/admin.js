const express = require('express');
const router = express.Router();
const DataStore = require('../modules/dataStore');
const ExpiryChecker = require('../modules/expiryChecker');
const CleanupTask = require('../modules/cleanupTask');

router.get('/shares', (req, res) => {
  try {
    const shares = DataStore.getAllShares().map(share => ({
      ...share,
      statusText: ExpiryChecker.getShareStatus(share),
      isExpired: ExpiryChecker.isExpired(share),
      isLimitReached: ExpiryChecker.isDownloadLimitReached(share)
    })).sort((a, b) => b.uploadTime - a.uploadTime);

    res.json({
      success: true,
      data: shares
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.get('/logs', (req, res) => {
  try {
    const logs = DataStore.getDownloadLogs().sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.get('/stats', (req, res) => {
  try {
    const stats = CleanupTask.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.post('/cleanup', async (req, res) => {
  try {
    const result = await CleanupTask.forceCleanup();
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.delete('/share/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const share = DataStore.getShareByCode(code);
    
    if (!share) {
      return res.status(404).json({
        success: false,
        message: '分享不存在'
      });
    }

    if (ExpiryChecker.isDownloading(share)) {
      return res.status(400).json({
        success: false,
        message: '该文件正在下载中，请稍后再试'
      });
    }

    await CleanupTask.forceDeleteShare(code);

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;

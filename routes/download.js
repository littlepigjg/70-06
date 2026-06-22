const express = require('express');
const router = express.Router();
const UploadHandler = require('../modules/uploadHandler');

router.get('/info/:code', (req, res) => {
  try {
    const info = UploadHandler.getShareInfo(req.params.code);
    res.json({
      success: true,
      data: info
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

router.post('/:code', async (req, res) => {
  const code = req.params.code;
  let downloadSession = null;
  let downloadFinalized = false;
  let willReachLimit = false;

  const finalizeAndRelease = async (success) => {
    if (downloadFinalized || !downloadSession) return;
    downloadFinalized = true;

    try {
      console.log(`[${new Date().toLocaleString()}] 下载结束处理 [${success ? '成功' : '失败'}]: ${code}, 开始finalize...`);
      await UploadHandler.finalizeDownload(code, success, willReachLimit);
      console.log(`[${new Date().toLocaleString()}] finalize完成: ${code}`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] finalize失败: ${code} - ${err.message}`);
    } finally {
      if (downloadSession && downloadSession.releaseLock) {
        downloadSession.releaseLock();
        console.log(`[${new Date().toLocaleString()}] 锁已释放: ${code}`);
      }
    }
  };

  try {
    const ip = req.ip || req.connection.remoteAddress ||
               req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
    const userAgent = req.headers['user-agent'] || '';

    console.log(`[${new Date().toLocaleString()}] ========== 下载请求开始: ${code}, IP: ${ip} ==========`);
    downloadSession = await UploadHandler.startDownload(code, ip, userAgent);
    willReachLimit = downloadSession.willReachLimit || false;
    console.log(`[${new Date().toLocaleString()}] 下载会话创建成功: ${code}, 当前次数: ${downloadSession.share.downloadCount}/${downloadSession.share.maxDownloads === -1 ? '∞' : downloadSession.share.maxDownloads}, willReachLimit=${willReachLimit}`);

    res.on('finish', async () => {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      console.log(`[${new Date().toLocaleString()}] Response finish: ${code}, status=${res.statusCode}, success=${success}`);
      await finalizeAndRelease(success);
    });

    res.on('close', async () => {
      const wasSuccessful = res.headersSent && res.statusCode >= 200 && res.statusCode < 300;
      console.log(`[${new Date().toLocaleString()}] Connection close: ${code}, headersSent=${res.headersSent}, status=${res.statusCode}, treatingAsSuccess=${wasSuccessful}`);
      await finalizeAndRelease(wasSuccessful);
    });

    res.download(downloadSession.filePath, downloadSession.originalName, {
      headers: {
        'Content-Type': downloadSession.mimetype,
        'Content-Length': downloadSession.size
      }
    }, async (err) => {
      if (err) {
        console.error(`[${new Date().toLocaleString()}] res.download 错误: ${code} - ${err.message}`);
        await finalizeAndRelease(false);
      }
    });

  } catch (err) {
    console.error(`[${new Date().toLocaleString()}] 下载请求失败: ${code} - ${err.message}`);
    await finalizeAndRelease(false);
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;

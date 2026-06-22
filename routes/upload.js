const express = require('express');
const router = express.Router();
const UploadHandler = require('../modules/uploadHandler');

router.post('/', UploadHandler.getUploadMiddleware(), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的文件'
      });
    }

    const options = {
      maxDownloads: req.body.maxDownloads,
      expiryHours: req.body.expiryHours,
      customCode: req.body.customCode
    };

    const result = await UploadHandler.createShare(req.file, options);

    res.json({
      success: true,
      message: '上传成功',
      data: {
        ...result,
        shareUrl: `${req.protocol}://${req.get('host')}/download.html?code=${result.code}`
      }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;

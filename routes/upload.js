const express = require('express');
const router = express.Router();
const config = require('../config');
const UploadHandler = require('../modules/uploadHandler');
const ChunkManager = require('../modules/chunkManager');

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

router.post('/chunks/init', async (req, res) => {
  try {
    const { originalName, size, mimetype, fileHash } = req.body;

    if (!originalName || !size) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: originalName, size'
      });
    }

    const fileSize = parseInt(size);
    if (fileSize <= 0) {
      return res.status(400).json({
        success: false,
        message: '文件大小无效'
      });
    }

    if (fileSize > config.MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `文件大小超过限制，最大允许 ${config.MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }

    const chunkSize = config.CHUNK_SIZE;
    const totalChunks = Math.ceil(fileSize / chunkSize);

    const result = ChunkManager.createSession({
      originalName,
      size: fileSize,
      mimetype: mimetype || 'application/octet-stream',
      totalChunks,
      fileHash: fileHash || null,
      chunkSize
    });

    res.json({
      success: true,
      message: '分片上传初始化成功',
      data: {
        ...result,
        chunkSize,
        threshold: config.CHUNK_THRESHOLD
      }
    });
  } catch (err) {
    console.error('[Chunks Init] Error:', err);
    res.status(500).json({
      success: false,
      message: '初始化失败: ' + err.message
    });
  }
});

router.post('/chunks/upload', async (req, res) => {
  try {
    const uploadId = req.body.uploadId || req.query.uploadId;
    const chunkIndex = parseInt(req.body.chunkIndex ?? req.query.chunkIndex);
    const chunkHash = req.body.chunkHash || req.query.chunkHash;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        message: '缺少 uploadId'
      });
    }

    if (isNaN(chunkIndex)) {
      return res.status(400).json({
        success: false,
        message: '缺少或无效的 chunkIndex'
      });
    }

    const session = ChunkManager.getSession(uploadId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: '上传会话不存在或已过期，请重新上传'
      });
    }

    let chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) {
          return res.status(400).json({
            success: false,
            message: '分片数据为空'
          });
        }

        const result = await ChunkManager.saveChunk(uploadId, chunkIndex, buffer, chunkHash);

        res.json({
          success: true,
          message: `分片 ${chunkIndex} 上传成功`,
          data: result
        });
      } catch (err) {
        console.error('[Chunks Upload] Error:', err);
        res.status(400).json({
          success: false,
          message: err.message
        });
      }
    });

    req.on('error', (err) => {
      console.error('[Chunks Upload] Stream Error:', err);
      res.status(500).json({
        success: false,
        message: '上传流错误: ' + err.message
      });
    });

  } catch (err) {
    console.error('[Chunks Upload] Error:', err);
    res.status(500).json({
      success: false,
      message: '上传失败: ' + err.message
    });
  }
});

router.post('/chunks/merge', async (req, res) => {
  try {
    const { uploadId, maxDownloads, expiryHours, customCode } = req.body;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        message: '缺少 uploadId'
      });
    }

    const session = ChunkManager.getSession(uploadId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: '上传会话不存在或已过期，请重新上传'
      });
    }

    const mergedFile = await ChunkManager.mergeChunks(uploadId);

    const file = {
      filename: mergedFile.filename,
      originalname: mergedFile.originalName,
      size: mergedFile.size,
      mimetype: mergedFile.mimetype
    };

    const options = {
      maxDownloads,
      expiryHours,
      customCode
    };

    const result = await UploadHandler.createShare(file, options);

    res.json({
      success: true,
      message: '文件合并成功，分享已创建',
      data: {
        ...result,
        shareUrl: `${req.protocol}://${req.get('host')}/download.html?code=${result.code}`
      }
    });
  } catch (err) {
    console.error('[Chunks Merge] Error:', err);
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

router.get('/chunks/status/:uploadId', (req, res) => {
  try {
    const { uploadId } = req.params;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        message: '缺少 uploadId'
      });
    }

    const session = ChunkManager.getSession(uploadId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: '上传会话不存在或已过期'
      });
    }

    res.json({
      success: true,
      data: session
    });
  } catch (err) {
    console.error('[Chunks Status] Error:', err);
    res.status(500).json({
      success: false,
      message: '查询失败: ' + err.message
    });
  }
});

module.exports = router;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class ChunkManager {
  constructor() {
    this.chunkSessions = new Map();
    this.dirty = false;
    this.initialized = false;
    this.flushInterval = null;
  }

  init() {
    if (this.initialized) return;

    this._ensureDirs();

    try {
      if (fs.existsSync(config.CHUNK_STATE_FILE)) {
        const data = fs.readFileSync(config.CHUNK_STATE_FILE, 'utf8');
        const sessions = JSON.parse(data);
        for (const session of sessions) {
          session.receivedChunks = new Set(session.receivedChunks || []);
          this.chunkSessions.set(session.uploadId, session);
        }
        console.log(`[ChunkManager] 已加载 ${this.chunkSessions.size} 个分片上传会话`);
      }
    } catch (err) {
      console.error('[ChunkManager] 加载分片状态失败:', err.message);
    }

    this.flushInterval = setInterval(() => {
      this.flush();
    }, 2000);

    this.initialized = true;
  }

  _ensureDirs() {
    if (!fs.existsSync(config.UPLOAD_DIR)) {
      fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
    }
    if (!fs.existsSync(config.CHUNK_DIR)) {
      fs.mkdirSync(config.CHUNK_DIR, { recursive: true });
    }
  }

  createSession(fileInfo) {
    const { originalName, size, mimetype, totalChunks, fileHash, chunkSize } = fileInfo;
    const uploadId = uuidv4();
    const sessionDir = path.join(config.CHUNK_DIR, uploadId);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const session = {
      uploadId,
      originalName,
      size: parseInt(size),
      mimetype,
      totalChunks: parseInt(totalChunks),
      chunkSize: parseInt(chunkSize),
      fileHash,
      receivedChunks: new Set(),
      sessionDir,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'uploading',
      mergedFilename: null
    };

    this.chunkSessions.set(uploadId, session);
    this.dirty = true;
    this.flush();

    return {
      uploadId,
      totalChunks: session.totalChunks,
      chunkSize: session.chunkSize,
      receivedChunks: []
    };
  }

  getSession(uploadId) {
    const session = this.chunkSessions.get(uploadId);
    if (!session) return null;
    return {
      uploadId: session.uploadId,
      originalName: session.originalName,
      size: session.size,
      mimetype: session.mimetype,
      totalChunks: session.totalChunks,
      chunkSize: session.chunkSize,
      fileHash: session.fileHash,
      receivedChunks: Array.from(session.receivedChunks),
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      status: session.status,
      progress: session.receivedChunks.size / session.totalChunks
    };
  }

  async saveChunk(uploadId, chunkIndex, buffer, expectedHash) {
    const session = this.chunkSessions.get(uploadId);
    if (!session) {
      throw new Error('上传会话不存在或已过期');
    }

    if (session.status !== 'uploading') {
      throw new Error('当前会话状态不允许上传分片');
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error('分片索引超出范围');
    }

    const actualHash = crypto.createHash('md5').update(buffer).digest('hex');
    if (expectedHash && actualHash !== expectedHash) {
      throw new Error('分片完整性校验失败');
    }

    const chunkPath = path.join(session.sessionDir, `${chunkIndex}`);
    fs.writeFileSync(chunkPath, buffer);

    session.receivedChunks.add(chunkIndex);
    session.lastActivity = Date.now();
    this.dirty = true;
    this.flush();

    return {
      uploadId,
      chunkIndex,
      receivedCount: session.receivedChunks.size,
      totalChunks: session.totalChunks,
      isComplete: session.receivedChunks.size === session.totalChunks
    };
  }

  async mergeChunks(uploadId, options = {}) {
    const session = this.chunkSessions.get(uploadId);
    if (!session) {
      throw new Error('上传会话不存在或已过期');
    }

    if (session.receivedChunks.size !== session.totalChunks) {
      throw new Error(`分片未全部接收，已接收 ${session.receivedChunks.size}/${session.totalChunks}`);
    }

    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.has(i)) {
        throw new Error(`缺少分片: ${i}`);
      }
    }

    session.status = 'merging';
    this.dirty = true;
    this.flush();

    const mergedFilename = uuidv4() + path.extname(session.originalName);
    const mergedPath = path.join(config.UPLOAD_DIR, mergedFilename);

    let totalSize = 0;
    const writeStream = fs.createWriteStream(mergedPath);

    try {
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(session.sessionDir, `${i}`);
        const chunkBuffer = fs.readFileSync(chunkPath);
        totalSize += chunkBuffer.length;

        await new Promise((resolve, reject) => {
          writeStream.write(chunkBuffer, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      await new Promise((resolve, reject) => {
        writeStream.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (totalSize !== session.size) {
        if (fs.existsSync(mergedPath)) {
          fs.unlinkSync(mergedPath);
        }
        throw new Error(`合并后文件大小不匹配: 期望 ${session.size}, 实际 ${totalSize}`);
      }

      if (session.fileHash) {
        const fileHash = await this._computeFileHash(mergedPath);
        if (fileHash !== session.fileHash) {
          if (fs.existsSync(mergedPath)) {
            fs.unlinkSync(mergedPath);
          }
          throw new Error('文件完整性校验失败，哈希不匹配');
        }
      }

      session.status = 'completed';
      session.mergedFilename = mergedFilename;
      session.lastActivity = Date.now();
      this.dirty = true;
      this.flush();

      this._cleanupSessionDir(uploadId);

      return {
        filename: mergedFilename,
        originalName: session.originalName,
        size: session.size,
        mimetype: session.mimetype
      };

    } catch (err) {
      if (fs.existsSync(mergedPath)) {
        try { fs.unlinkSync(mergedPath); } catch (_) {}
      }
      session.status = 'uploading';
      this.dirty = true;
      this.flush();
      throw err;
    }
  }

  _computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  _cleanupSessionDir(uploadId) {
    const session = this.chunkSessions.get(uploadId);
    if (!session) return;

    try {
      if (fs.existsSync(session.sessionDir)) {
        const files = fs.readdirSync(session.sessionDir);
        for (const file of files) {
          const filePath = path.join(session.sessionDir, file);
          fs.unlinkSync(filePath);
        }
        fs.rmdirSync(session.sessionDir);
      }
    } catch (err) {
      console.error(`[ChunkManager] 清理分片目录失败 ${uploadId}:`, err.message);
    }
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    const expired = [];

    for (const [uploadId, session] of this.chunkSessions) {
      if (session.status === 'completed') continue;

      const age = now - session.lastActivity;
      if (age > config.CHUNK_TIMEOUT) {
        expired.push(uploadId);
      }
    }

    let cleanedCount = 0;
    for (const uploadId of expired) {
      try {
        this._cleanupSessionDir(uploadId);
        this.chunkSessions.delete(uploadId);
        cleanedCount++;
      } catch (err) {
        console.error(`[ChunkManager] 删除过期会话失败 ${uploadId}:`, err.message);
      }
    }

    if (cleanedCount > 0) {
      this.dirty = true;
      this.flush();
      console.log(`[ChunkManager] 清理了 ${cleanedCount} 个过期分片会话`);
    }

    return cleanedCount;
  }

  flush() {
    if (!this.dirty) return;

    try {
      const sessions = Array.from(this.chunkSessions.values()).map(s => ({
        ...s,
        receivedChunks: Array.from(s.receivedChunks || [])
      }));
      const tmpFile = config.CHUNK_STATE_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(sessions, null, 2));
      fs.renameSync(tmpFile, config.CHUNK_STATE_FILE);
      this.dirty = false;
    } catch (err) {
      console.error('[ChunkManager] 持久化失败:', err.message);
    }
  }

  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    this.initialized = false;
  }

  getStats() {
    let uploading = 0, merging = 0, completed = 0, totalSize = 0;
    for (const session of this.chunkSessions.values()) {
      if (session.status === 'uploading') uploading++;
      else if (session.status === 'merging') merging++;
      else if (session.status === 'completed') completed++;
      totalSize += session.receivedChunks.size * session.chunkSize;
    }
    return {
      total: this.chunkSessions.size,
      uploading,
      merging,
      completed,
      totalChunkSize: totalSize
    };
  }
}

const chunkManager = new ChunkManager();

module.exports = chunkManager;

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const settings = document.getElementById('settings');
const uploadBtn = document.getElementById('uploadBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultCard = document.getElementById('resultCard');
const errorAlert = document.getElementById('errorAlert');
const successAlert = document.getElementById('successAlert');
const customCodeInput = document.getElementById('customCode');

let selectedFile = null;
let isUploading = false;
let abortController = null;

const CHUNK_THRESHOLD = 100 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT = 3;
const MAX_RETRY = 3;
const RESUME_KEY_PREFIX = 'chunk_upload_';

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showAlert(element, message) {
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => {
    element.classList.remove('show');
  }, 3000);
}

async function computeFileHash(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const chunkSize = 2 * 1024 * 1024;
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    let hash = null;

    if (window.crypto && window.crypto.subtle) {
      hash = new SparkMD5.ArrayBuffer();
    } else {
      return resolve(`${file.name}_${file.size}_${file.lastModified}`);
    }

    const loadNext = () => {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      reader.readAsArrayBuffer(file.slice(start, end));
    };

    reader.onload = (e) => {
      hash.append(e.target.result);
      currentChunk++;
      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve(hash.end());
      }
    };

    reader.onerror = () => {
      resolve(`${file.name}_${file.size}_${file.lastModified}`);
    };

    loadNext();
  });
}

async function computeChunkHash(chunk) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (window.crypto && window.crypto.subtle) {
        const hash = new SparkMD5.ArrayBuffer();
        hash.append(e.target.result);
        resolve(hash.end());
      } else {
        resolve('');
      }
    };
    reader.onerror = () => resolve('');
    reader.readAsArrayBuffer(chunk);
  });
}

function getResumeInfo(fileHash) {
  try {
    const key = RESUME_KEY_PREFIX + fileHash;
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (_) {}
  return null;
}

function saveResumeInfo(fileHash, info) {
  try {
    const key = RESUME_KEY_PREFIX + fileHash;
    localStorage.setItem(key, JSON.stringify(info));
  } catch (_) {}
}

function clearResumeInfo(fileHash) {
  try {
    const key = RESUME_KEY_PREFIX + fileHash;
    localStorage.removeItem(key);
  } catch (_) {}
}

async function initChunkUpload(file, fileHash) {
  const response = await fetch('/api/upload/chunks/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originalName: file.name,
      size: file.size,
      mimetype: file.type || 'application/octet-stream',
      fileHash: fileHash
    })
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || '初始化失败');
  }
  return result.data;
}

async function queryChunkStatus(uploadId) {
  const response = await fetch(`/api/upload/chunks/status/${uploadId}`);
  const result = await response.json();
  if (!result.success) {
    return null;
  }
  return result.data;
}

async function uploadChunk(uploadId, chunkIndex, chunk, chunkHash, signal) {
  const queryParams = new URLSearchParams({
    uploadId,
    chunkIndex,
    chunkHash: chunkHash || ''
  });

  const response = await fetch(`/api/upload/chunks/upload?${queryParams}`, {
    method: 'POST',
    body: chunk,
    signal: signal
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || `分片 ${chunkIndex} 上传失败`);
  }
  return result.data;
}

async function mergeChunks(uploadId, options) {
  const response = await fetch('/api/upload/chunks/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      maxDownloads: options.maxDownloads,
      expiryHours: options.expiryHours,
      customCode: options.customCode
    })
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || '合并失败');
  }
  return result.data;
}

function updateProgress(uploaded, total, extraText = '') {
  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  progressFill.style.width = percent + '%';
  let text = `上传中... ${percent}% (${formatFileSize(uploaded)} / ${formatFileSize(total)})`;
  if (extraText) {
    text += ` - ${extraText}`;
  }
  progressText.textContent = text;
}

async function uploadChunks(file, initData, fileHash, onProgress) {
  const { uploadId, totalChunks, chunkSize, receivedChunks = [] } = initData;
  const uploadedSet = new Set(receivedChunks);
  const failedChunks = new Map();
  const abortSignals = [];

  abortController = new AbortController();

  let uploadedBytes = uploadedSet.size * chunkSize;
  uploadedBytes = Math.min(uploadedBytes, file.size);
  onProgress(uploadedBytes, file.size, `准备上传 ${totalChunks - uploadedSet.size} 个分片`);

  const uploadOne = async (chunkIndex) => {
    if (abortController.signal.aborted) return;
    if (uploadedSet.has(chunkIndex)) return;

    const signal = abortController.signal;
    abortSignals.push({ chunkIndex, signal });

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    let retryCount = 0;
    while (retryCount < MAX_RETRY && !signal.aborted) {
      try {
        const chunkHash = await computeChunkHash(chunk);
        await uploadChunk(uploadId, chunkIndex, chunk, chunkHash, signal);

        uploadedSet.add(chunkIndex);
        failedChunks.delete(chunkIndex);
        const currentChunkSize = end - start;
        uploadedBytes = Math.min(uploadedBytes + currentChunkSize, file.size);
        const remaining = totalChunks - uploadedSet.size;

        saveResumeInfo(fileHash, {
          uploadId,
          receivedChunks: Array.from(uploadedSet),
          timestamp: Date.now()
        });

        onProgress(
          uploadedBytes,
          file.size,
          `剩余 ${remaining} 个分片` + (retryCount > 0 ? ` (重试${retryCount}次)` : '')
        );
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        retryCount++;
        if (retryCount >= MAX_RETRY) {
          failedChunks.set(chunkIndex, err.message);
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      }
    }
  };

  const pending = [];
  const queue = [];

  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedSet.has(i)) {
      queue.push(i);
    }
  }

  let activeCount = 0;
  const runNext = async () => {
    while (queue.length > 0 && activeCount < MAX_CONCURRENT && !abortController.signal.aborted) {
      const chunkIndex = queue.shift();
      activeCount++;
      const promise = uploadOne(chunkIndex)
        .catch(err => {})
        .finally(() => {
          activeCount--;
          return runNext();
        });
      pending.push(promise);
    }
  };

  await runNext();
  await Promise.all(pending);

  if (abortController.signal.aborted) {
    const err = new Error('上传已取消');
    err.name = 'AbortError';
    throw err;
  }

  if (failedChunks.size > 0) {
    const errors = Array.from(failedChunks.entries())
      .map(([idx, msg]) => `分片${idx}: ${msg}`)
      .join('; ');
    throw new Error(`部分分片上传失败: ${errors}`);
  }

  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedSet.has(i)) {
      throw new Error(`缺少分片: ${i}`);
    }
  }

  onProgress(file.size, file.size, '正在合并文件...');
  return uploadId;
}

function handleFileSelect(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.classList.add('show');
  settings.style.display = 'grid';
  uploadBtn.disabled = false;
  resultCard.classList.remove('show');
}

uploadArea.addEventListener('click', () => {
  if (!isUploading) {
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!isUploading) {
    uploadArea.classList.add('dragover');
  }
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0 && !isUploading) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

customCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    showAlert(errorAlert, '请先选择文件');
    return;
  }

  const expiryHours = document.getElementById('expiryHours').value;
  const maxDownloads = document.getElementById('maxDownloads').value;
  const customCode = customCodeInput.value.trim();

  if (customCode && (customCode.length < 4 || customCode.length > 8)) {
    showAlert(errorAlert, '自定义提取码长度必须在4-8位之间');
    return;
  }

  isUploading = true;
  uploadBtn.disabled = true;
  progressContainer.classList.add('show');
  resultCard.classList.remove('show');

  const options = { expiryHours, maxDownloads, customCode };

  try {
    if (selectedFile.size > CHUNK_THRESHOLD) {
      await startChunkedUpload(selectedFile, options);
    } else {
      await startNormalUpload(selectedFile, options);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      showAlert(errorAlert, '上传已取消');
    } else {
      showAlert(errorAlert, err.message || '上传失败');
    }
  } finally {
    isUploading = false;
    uploadBtn.disabled = false;
    abortController = null;
  }
});

async function startNormalUpload(file, options) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('expiryHours', options.expiryHours);
  formData.append('maxDownloads', options.maxDownloads);
  if (options.customCode) {
    formData.append('customCode', options.customCode);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        updateProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const response = JSON.parse(xhr.responseText);
        if (response.success) {
          handleUploadSuccess(response.data);
          resolve();
        } else {
          reject(new Error(response.message || '上传失败'));
        }
      } catch (err) {
        reject(new Error('服务器响应错误'));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('网络错误，请重试'));
    });

    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  });
}

async function startChunkedUpload(file, options) {
  progressText.textContent = '正在计算文件校验码...';

  const fileHash = await computeFileHash(file);
  const resumeInfo = getResumeInfo(fileHash);

  let initData;
  let shouldCheckResume = false;

  if (resumeInfo && resumeInfo.uploadId) {
    try {
      const status = await queryChunkStatus(resumeInfo.uploadId);
      if (status && status.status !== 'completed') {
        initData = {
          uploadId: status.uploadId,
          totalChunks: status.totalChunks,
          chunkSize: status.chunkSize,
          receivedChunks: status.receivedChunks
        };
        shouldCheckResume = true;
        showAlert(successAlert, `检测到未完成的上传，继续上传 (${initData.receivedChunks.length}/${initData.totalChunks})`);
      }
    } catch (_) {}
  }

  if (!initData) {
    progressText.textContent = '正在初始化分片上传...';
    initData = await initChunkUpload(file, fileHash);
    clearResumeInfo(fileHash);
  }

  const uploadId = await uploadChunks(
    file,
    initData,
    fileHash,
    (uploaded, total, extra) => updateProgress(uploaded, total, extra)
  );

  progressText.textContent = '正在合并分片并创建分享...';

  const result = await mergeChunks(uploadId, options);

  clearResumeInfo(fileHash);
  handleUploadSuccess(result);
}

function handleUploadSuccess(data) {
  progressContainer.classList.remove('show');
  document.getElementById('resultCode').textContent = data.code;
  document.getElementById('resultFileName').textContent = data.originalName;
  document.getElementById('resultFileSize').textContent = formatFileSize(data.size);
  document.getElementById('resultExpiry').textContent = formatDate(data.expiryTime);
  document.getElementById('resultMaxDownloads').textContent =
    data.maxDownloads === -1 ? '不限制' : data.maxDownloads + ' 次';
  document.getElementById('resultLink').textContent = data.shareUrl;

  resultCard.classList.add('show');
  showAlert(successAlert, '分享创建成功！');

  fileInput.value = '';
  selectedFile = null;
  fileInfo.classList.remove('show');
  settings.style.display = 'none';
  customCodeInput.value = '';
}

document.getElementById('copyLinkBtn').addEventListener('click', () => {
  const link = document.getElementById('resultLink').textContent;
  navigator.clipboard.writeText(link).then(() => {
    showAlert(successAlert, '链接已复制到剪贴板');
  }).catch(() => {
    showAlert(errorAlert, '复制失败，请手动复制');
  });
});

document.getElementById('resultLink').addEventListener('click', () => {
  const link = document.getElementById('resultLink').textContent;
  navigator.clipboard.writeText(link).then(() => {
    showAlert(successAlert, '链接已复制到剪贴板');
  }).catch(() => {
    showAlert(errorAlert, '复制失败，请手动复制');
  });
});

document.getElementById('copyCodeBtn').addEventListener('click', () => {
  const code = document.getElementById('resultCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showAlert(successAlert, '提取码已复制到剪贴板');
  }).catch(() => {
    showAlert(errorAlert, '复制失败，请手动复制');
  });
});

document.getElementById('createNewBtn').addEventListener('click', () => {
  resultCard.classList.remove('show');
  uploadBtn.disabled = true;
  progressFill.style.width = '0%';
});

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
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
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

  uploadBtn.disabled = true;
  progressContainer.classList.add('show');
  resultCard.classList.remove('show');

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('expiryHours', expiryHours);
  formData.append('maxDownloads', maxDownloads);
  if (customCode) {
    formData.append('customCode', customCode);
  }

  try {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = percent + '%';
        progressText.textContent = `上传中... ${percent}%`;
      }
    });

    xhr.addEventListener('load', () => {
      progressContainer.classList.remove('show');
      
      try {
        const response = JSON.parse(xhr.responseText);
        
        if (response.success) {
          const data = response.data;
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
        } else {
          showAlert(errorAlert, response.message || '上传失败');
          uploadBtn.disabled = false;
        }
      } catch (err) {
        showAlert(errorAlert, '服务器响应错误');
        uploadBtn.disabled = false;
      }
    });

    xhr.addEventListener('error', () => {
      progressContainer.classList.remove('show');
      showAlert(errorAlert, '网络错误，请重试');
      uploadBtn.disabled = false;
    });

    xhr.open('POST', '/api/upload');
    xhr.send(formData);

  } catch (err) {
    progressContainer.classList.remove('show');
    showAlert(errorAlert, err.message);
    uploadBtn.disabled = false;
  }
});

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

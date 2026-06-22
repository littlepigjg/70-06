const DataStore = require('./dataStore');

class CodeManager {
  static generateCode(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  static generateUniqueCode() {
    let code;
    let attempts = 0;
    do {
      code = this.generateCode();
      attempts++;
      if (attempts > 100) {
        code = this.generateCode(8);
        break;
      }
    } while (DataStore.getShareByCode(code));
    return code;
  }

  static validateCode(code) {
    if (!code || typeof code !== 'string') {
      return { valid: false, message: '提取码不能为空' };
    }
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 4 || cleanCode.length > 8) {
      return { valid: false, message: '提取码长度必须在4-8位之间' };
    }
    if (!/^[A-Z0-9]+$/.test(cleanCode)) {
      return { valid: false, message: '提取码只能包含大写字母和数字' };
    }
    return { valid: true, code: cleanCode };
  }

  static verifyCode(code) {
    const validation = this.validateCode(code);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }
    const share = DataStore.getShareByCode(validation.code);
    if (!share) {
      return { success: false, message: '提取码不存在' };
    }
    return { success: true, share };
  }
}

module.exports = CodeManager;

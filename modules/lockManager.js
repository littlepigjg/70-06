class LockHandle {
  constructor(manager, key) {
    this.manager = manager;
    this.key = key;
    this.released = false;
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.manager._releaseInternal(this.key);
  }
}

class LockManager {
  constructor() {
    this.locks = new Map();
    this.waitingQueues = new Map();
    this.lockCounts = new Map();
  }

  async acquire(key) {
    if (!this.locks.has(key)) {
      this.locks.set(key, false);
      this.waitingQueues.set(key, []);
      this.lockCounts.set(key, 0);
    }

    if (!this.locks.get(key)) {
      this.locks.set(key, true);
      this.lockCounts.set(key, 1);
      return new LockHandle(this, key);
    }

    return new Promise((resolve) => {
      this.waitingQueues.get(key).push(() => {
        this.lockCounts.set(key, 1);
        resolve(new LockHandle(this, key));
      });
    });
  }

  _releaseInternal(key) {
    if (!this.locks.has(key)) return;

    const count = (this.lockCounts.get(key) || 1) - 1;
    this.lockCounts.set(key, count);

    if (count > 0) return;

    const queue = this.waitingQueues.get(key);
    
    if (queue.length > 0) {
      const next = queue.shift();
      next();
    } else {
      this.locks.set(key, false);
    }
  }

  async withLock(key, fn) {
    const handle = await this.acquire(key);
    try {
      return await fn(handle);
    } finally {
      handle.release();
    }
  }

  isLocked(key) {
    return this.locks.has(key) && this.locks.get(key) === true;
  }

  getLockStatus(key) {
    return {
      locked: this.isLocked(key),
      waitingCount: this.waitingQueues.has(key) ? this.waitingQueues.get(key).length : 0,
      holderCount: this.lockCounts.has(key) ? this.lockCounts.get(key) : 0
    };
  }

  getLockedKeys() {
    const result = [];
    for (const [key, locked] of this.locks) {
      if (locked) {
        result.push({
          key,
          waiting: this.waitingQueues.get(key)?.length || 0
        });
      }
    }
    return result;
  }
}

const lockManager = new LockManager();

module.exports = lockManager;
module.exports.LockHandle = LockHandle;

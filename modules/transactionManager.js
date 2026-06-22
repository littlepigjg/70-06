const stateCache = require('./stateCache');

class Transaction {
  constructor(id) {
    this.id = id;
    this.operations = [];
    this.compensations = [];
    this.completed = false;
    this.rolledBack = false;
  }

  addOperation(execute, rollback) {
    this.operations.push(execute);
    this.compensations.unshift(rollback);
  }

  async commit() {
    if (this.completed || this.rolledBack) return;

    const snapshots = [];

    for (let i = 0; i < this.operations.length; i++) {
      try {
        const op = this.operations[i];
        const result = await op(snapshots);
        snapshots.push(result);
      } catch (err) {
        console.error(`[Transaction ${this.id}] 操作 ${i} 失败: ${err.message}`);
        await this.rollback(snapshots);
        throw err;
      }
    }

    this.completed = true;
    return snapshots;
  }

  async rollback(snapshots) {
    if (this.rolledBack) return;
    this.rolledBack = true;

    console.log(`[Transaction ${this.id}] 开始回滚 ${this.compensations.length} 步`);

    for (let i = 0; i < this.compensations.length; i++) {
      try {
        const compensation = this.compensations[i];
        const snapshot = snapshots ? snapshots[this.compensations.length - 1 - i] : null;
        await compensation(snapshot);
      } catch (err) {
        console.error(`[Transaction ${this.id}] 回滚步骤 ${i} 失败: ${err.message}`);
      }
    }

    stateCache.flush();
    console.log(`[Transaction ${this.id}] 回滚完成`);
  }
}

class TransactionManager {
  constructor() {
    this.activeTransactions = new Map();
    this.counter = 0;
  }

  create() {
    this.counter++;
    const id = `tx_${Date.now()}_${this.counter}`;
    const tx = new Transaction(id);
    this.activeTransactions.set(id, tx);
    return tx;
  }

  async run(fn) {
    const tx = this.create();
    try {
      await fn(tx);
      const results = await tx.commit();
      this.activeTransactions.delete(tx.id);
      stateCache.flush();
      return results;
    } catch (err) {
      this.activeTransactions.delete(tx.id);
      throw err;
    }
  }

  getActiveCount() {
    return this.activeTransactions.size;
  }
}

const transactionManager = new TransactionManager();

module.exports = transactionManager;

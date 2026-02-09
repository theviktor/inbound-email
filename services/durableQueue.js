const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class DurableQueue {
  constructor(basePath) {
    this.basePath = basePath;
    this._initialized = false;
    this._initPromise = this.ensureInitialized();
  }

  async ensureInitialized() {
    if (this._initialized) {
      return;
    }

    await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });
    this._initialized = true;
  }

  async create(taskPayload) {
    await this._initPromise;

    const id = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const filepath = this._pathForId(id);
    const payload = {
      id,
      createdAt: new Date().toISOString(),
      ...taskPayload
    };

    await fs.writeFile(filepath, JSON.stringify(payload), { mode: 0o600 });
    return id;
  }

  async get(id) {
    await this._initPromise;
    const filepath = this._pathForId(id);
    const content = await fs.readFile(filepath, 'utf8');
    return JSON.parse(content);
  }

  async update(id, patch) {
    await this._initPromise;
    const current = await this.get(id);
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(this._pathForId(id), JSON.stringify(next), { mode: 0o600 });
  }

  async remove(id) {
    await this._initPromise;
    try {
      await fs.unlink(this._pathForId(id));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async listIds() {
    await this._initPromise;
    const files = await fs.readdir(this.basePath);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort();
  }

  async count() {
    const ids = await this.listIds();
    return ids.length;
  }

  _pathForId(id) {
    return path.join(this.basePath, `${id}.json`);
  }
}

module.exports = DurableQueue;

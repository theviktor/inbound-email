const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class LocalStorage {
  constructor(config) {
    this.basePath = config.LOCAL_STORAGE_PATH || './temp-attachments';
    this.retentionHours = config.LOCAL_STORAGE_RETENTION || 24;
    this.encryptionKey = this.parseEncryptionKey(config.LOCAL_STORAGE_ENCRYPTION_KEY);
    this._initialized = false;
    this._initPromise = this.initializeStorage();
  }

  async initializeStorage() {
    try {
      await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });
      this._initialized = true;
      logger.info(`Local storage initialized at: ${this.basePath}`);
      if (this.encryptionKey) {
        logger.info('Local storage encryption at rest is enabled');
      }
      this.startCleanupTask();
    } catch (error) {
      logger.error('Failed to initialize local storage:', error);
      throw error;
    }
  }

  async ensureInitialized() {
    if (!this._initialized) {
      await this._initPromise;
    }
  }

  async save(attachment) {
    try {
      await this.ensureInitialized();

      const filename = this.generateFilename(attachment.filename);
      const filepath = path.join(this.basePath, filename);
      const content = Buffer.from(attachment.content);
      const encrypted = this.encryptContent(content);
      
      await fs.writeFile(filepath, encrypted.content, { mode: 0o600 });
      
      const metadata = {
        fileId: filename,
        originalName: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        savedAt: new Date().toISOString(),
        encrypted: !!encrypted.encryption,
        encryption: encrypted.encryption || null
      };
      
      await fs.writeFile(`${filepath}.meta`, JSON.stringify(metadata, null, 2), { mode: 0o600 });
      
      logger.info(`Attachment saved locally: ${filename}`);
      
      return {
        success: true,
        location: filepath,
        storageType: 'local',
        metadata: metadata
      };
    } catch (error) {
      logger.error('Local storage save error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  generateFilename(originalName) {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    return `${timestamp}-${hash}-${base}${ext}`;
  }

  parseEncryptionKey(rawValue) {
    if (!rawValue) {
      return null;
    }

    const trimmed = rawValue.trim();
    let key;
    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
      key = Buffer.from(trimmed, 'hex');
    } else {
      key = Buffer.from(trimmed, 'base64');
    }

    if (key.length !== 32) {
      throw new Error('LOCAL_STORAGE_ENCRYPTION_KEY must decode to 32 bytes (AES-256 key)');
    }

    return key;
  }

  encryptContent(content) {
    if (!this.encryptionKey) {
      return { content, encryption: null };
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encryptedContent = Buffer.concat([cipher.update(content), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      content: encryptedContent,
      encryption: {
        algorithm: 'aes-256-gcm',
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      }
    };
  }

  decryptContent(content, metadata) {
    if (!metadata?.encrypted) {
      return content;
    }

    if (!this.encryptionKey || !metadata.encryption?.iv || !metadata.encryption?.authTag) {
      throw new Error('Encrypted local file is missing decrypt configuration');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(metadata.encryption.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(metadata.encryption.authTag, 'hex'));
    return Buffer.concat([decipher.update(content), decipher.final()]);
  }

  async cleanup() {
    try {
      const files = await fs.readdir(this.basePath);
      const now = Date.now();
      const maxAge = this.retentionHours * 60 * 60 * 1000;
      
      for (const file of files) {
        if (file.endsWith('.meta')) continue;
        
        const filepath = path.join(this.basePath, file);
        const metaPath = `${filepath}.meta`;
        
        try {
          const stats = await fs.stat(filepath);
          const age = now - stats.mtimeMs;
          
          if (age > maxAge) {
            await fs.unlink(filepath);
            try {
              await fs.unlink(metaPath);
            } catch (e) {
              // Meta file might not exist
            }
            logger.info(`Cleaned up old file: ${file}`);
          }
        } catch (error) {
          logger.error(`Error processing file ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error('Cleanup error:', error);
    }
  }

  startCleanupTask() {
    // Run cleanup every hour
    const cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
    cleanupInterval.unref();
    
    // Run initial cleanup
    this.cleanup();
  }

  async getRetryQueue() {
    try {
      await this.ensureInitialized();
      const files = await fs.readdir(this.basePath);
      const queue = [];
      
      for (const file of files) {
        if (file.endsWith('.meta')) {
          const metaPath = path.join(this.basePath, file);
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
          const dataPath = metaPath.replace('.meta', '');
          
          try {
            await fs.stat(dataPath);
            queue.push({
              filepath: dataPath,
              metadata: meta
            });
          } catch (e) {
            // Data file doesn't exist, clean up meta file
            await fs.unlink(metaPath);
          }
        }
      }
      
      return queue;
    } catch (error) {
      logger.error('Error getting retry queue:', error);
      return [];
    }
  }

  async remove(filepath) {
    try {
      await fs.unlink(filepath);
      await fs.unlink(`${filepath}.meta`);
      logger.info(`Removed local file: ${filepath}`);
    } catch (error) {
      logger.error(`Error removing file ${filepath}:`, error);
    }
  }

  async read(filepath) {
    try {
      await this.ensureInitialized();
      const [content, metaRaw] = await Promise.all([
        fs.readFile(filepath),
        fs.readFile(`${filepath}.meta`, 'utf8')
      ]);
      const metadata = JSON.parse(metaRaw);
      return this.decryptContent(content, metadata);
    } catch (error) {
      logger.error(`Error reading file ${filepath}:`, error);
      throw error;
    }
  }
}

module.exports = LocalStorage;

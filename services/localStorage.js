const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

class LocalStorage {
  constructor(config) {
    this.basePath = config.LOCAL_STORAGE_PATH || './temp-attachments';
    this.retentionHours = config.LOCAL_STORAGE_RETENTION || 24;
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      logger.info(`Local storage initialized at: ${this.basePath}`);
      this.startCleanupTask();
    } catch (error) {
      logger.error('Failed to initialize local storage:', error);
    }
  }

  async save(attachment) {
    try {
      const filename = this.generateFilename(attachment.filename);
      const filepath = path.join(this.basePath, filename);
      
      await fs.writeFile(filepath, attachment.content);
      
      const metadata = {
        originalName: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        savedAt: new Date().toISOString(),
        filepath: filepath
      };
      
      await fs.writeFile(`${filepath}.meta`, JSON.stringify(metadata, null, 2));
      
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
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
    
    // Run initial cleanup
    this.cleanup();
  }

  async getRetryQueue() {
    try {
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
}

module.exports = LocalStorage;
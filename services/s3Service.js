const fs = require('fs').promises;
const config = require('../config');
const LocalStorage = require('./localStorage');
const logger = require('./logger');
const { Upload } = require('@aws-sdk/lib-storage');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');

const localStorage = new LocalStorage(config);
const retryQueue = new Map(); // Use Map with unique IDs to prevent duplicates
let retryInterval = null;
let retryAttempts = new Map(); // Track retry attempts per item

async function uploadToS3(attachment) {
  if (attachment.size > config.MAX_FILE_SIZE) {
    logger.info(`Skipping large attachment: ${attachment.filename} (${attachment.size} bytes)`);
    return { location: null, storageType: 'skipped' };
  }

  // Check if S3 is configured
  if (!config.isS3Configured()) {
    logger.info('S3 not configured, using local storage');
    const localResult = await localStorage.save(attachment);
    if (localResult.success) {
      return { 
        location: localResult.location, 
        storageType: 'local',
        metadata: localResult.metadata
      };
    } else {
      throw new Error(`Local storage failed: ${localResult.error}`);
    }
  }

  const params = {
    Bucket: config.BUCKET_NAME,
    Key: `${Date.now()}-${attachment.filename}`,
    Body: Buffer.from(attachment.content), // Create a copy of the buffer
    ContentType: attachment.contentType
  };

  try {
    const upload = new Upload({
      client: config.s3,
      params: params
    });
    const result = await upload.done();
    logger.info(`Successfully uploaded to S3: ${attachment.filename}`);
    return { location: result.Location, storageType: 's3' };
  } catch (error) {
    logger.error('S3 upload error, falling back to local storage:', { 
      message: error.message,
      filename: attachment.filename 
    });
    
    // Fallback to local storage
    const localResult = await localStorage.save(attachment);
    
    if (localResult.success) {
      // Generate unique ID for this item
      const itemId = `${Date.now()}-${attachment.filename}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Add to retry queue with the local path as reference (don't store content in memory)
      retryQueue.set(itemId, {
        localPath: localResult.location,
        s3Key: params.Key,
        contentType: attachment.contentType,
        originalFilename: attachment.filename
      });
      retryAttempts.set(itemId, 0);
      
      // Start retry process if not already running
      if (!retryInterval) {
        startRetryProcess();
      }
      
      return { 
        location: localResult.location, 
        storageType: 'local',
        metadata: localResult.metadata
      };
    } else {
      throw new Error(`Both S3 and local storage failed: ${localResult.error}`);
    }
  }
}

function startRetryProcess() {
  const retryIntervalMinutes = config.S3_RETRY_INTERVAL;
  const maxRetries = config.S3_MAX_RETRIES;
  
  retryInterval = setInterval(async () => {
    // Check if S3 is configured
    if (!config.isS3Configured()) {
      logger.info('S3 not configured, skipping retry process');
      return;
    }
    
    // Load persisted files from previous runs if queue is empty
    if (retryQueue.size === 0) {
      const persistedQueue = await localStorage.getRetryQueue();
      if (persistedQueue.length === 0) {
        clearInterval(retryInterval);
        retryInterval = null;
        logger.info('Retry queue empty, stopping retry process');
        return;
      }
      
      // Add persisted files to retry queue
      for (const item of persistedQueue) {
        const itemId = `persisted-${item.filepath}`;
        if (!retryQueue.has(itemId)) {
          retryQueue.set(itemId, {
            localPath: item.filepath,
            s3Key: `${Date.now()}-${item.metadata.originalName}`,
            contentType: item.metadata.contentType,
            originalFilename: item.metadata.originalName
          });
          retryAttempts.set(itemId, retryAttempts.get(itemId) || 0);
        }
      }
    }
    
    // Process retry queue
    const itemsToRetry = Array.from(retryQueue.entries());
    
    for (const [itemId, item] of itemsToRetry) {
      const attempts = retryAttempts.get(itemId) || 0;
      
      // Check if max retries exceeded
      if (attempts >= maxRetries) {
        logger.error(`Max retries (${maxRetries}) exceeded for ${item.originalFilename}, giving up`);
        retryQueue.delete(itemId);
        retryAttempts.delete(itemId);
        continue;
      }
      
      try {
        // Read file content from disk (not from memory)
        const content = await fs.readFile(item.localPath);
        
        const upload = new Upload({
          client: config.s3,
          params: {
            Bucket: config.BUCKET_NAME,
            Key: item.s3Key,
            Body: content,
            ContentType: item.contentType
          }
        });
        await upload.done();
        logger.info(`Successfully uploaded to S3 on retry: ${item.originalFilename}`);
        
        // Remove local file after successful upload
        await localStorage.remove(item.localPath);
        retryQueue.delete(itemId);
        retryAttempts.delete(itemId);
      } catch (error) {
        retryAttempts.set(itemId, attempts + 1);
        logger.error(`Retry ${attempts + 1}/${maxRetries} failed for ${item.originalFilename}:`, {
          message: error.message
        });
      }
    }
  }, retryIntervalMinutes * 60 * 1000);
  retryInterval.unref();
  
  logger.info(`Started S3 retry process, checking every ${retryIntervalMinutes} minutes (max ${maxRetries} retries)`);
}

// Check S3 connectivity
async function checkS3Health() {
  if (!config.isS3Configured()) {
    return { configured: false, healthy: false };
  }
  
  try {
    await config.s3.send(new HeadBucketCommand({ Bucket: config.BUCKET_NAME }));
    return { configured: true, healthy: true };
  } catch (error) {
    logger.error('S3 health check failed:', { message: error.message });
    return { configured: true, healthy: false, error: error.message };
  }
}

// Initialize retry process on startup for any persisted files
(async () => {
  try {
    // Wait for localStorage to be initialized
    await localStorage.ensureInitialized();
    
    const persistedQueue = await localStorage.getRetryQueue();
    if (persistedQueue.length > 0 && config.isS3Configured()) {
      logger.info(`Found ${persistedQueue.length} files to retry uploading to S3`);
      startRetryProcess();
    }
  } catch (error) {
    logger.error('Failed to initialize retry process:', { message: error.message });
  }
})();

module.exports = { 
  uploadToS3, 
  checkS3Health,
  // Export for testing
  localStorage
};

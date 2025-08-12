const config = require('../config');
const LocalStorage = require('./localStorage');
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

const localStorage = new LocalStorage(config);
const retryQueue = [];
let retryInterval = null;

async function uploadToS3(attachment) {
  if (attachment.size > config.MAX_FILE_SIZE) {
    logger.info(`Skipping large attachment: ${attachment.filename} (${attachment.size} bytes)`);
    return { location: null, storageType: 'skipped' };
  }

  const params = {
    Bucket: config.BUCKET_NAME,
    Key: `${Date.now()}-${attachment.filename}`,
    Body: attachment.content,
    ContentType: attachment.contentType
  };

  try {
    const result = await config.s3.upload(params).promise();
    logger.info(`Successfully uploaded to S3: ${attachment.filename}`);
    return { location: result.Location, storageType: 's3' };
  } catch (error) {
    logger.error('S3 upload error, falling back to local storage:', error);
    
    // Fallback to local storage
    const localResult = await localStorage.save(attachment);
    
    if (localResult.success) {
      // Add to retry queue
      retryQueue.push({
        attachment: attachment,
        s3Params: params,
        localPath: localResult.location
      });
      
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
  const retryIntervalMinutes = config.S3_RETRY_INTERVAL || 5;
  
  retryInterval = setInterval(async () => {
    if (retryQueue.length === 0) {
      // Also check for files from previous runs
      const persistedQueue = await localStorage.getRetryQueue();
      if (persistedQueue.length === 0) {
        clearInterval(retryInterval);
        retryInterval = null;
        return;
      }
      
      // Add persisted files to retry queue
      for (const item of persistedQueue) {
        const content = await require('fs').promises.readFile(item.filepath);
        retryQueue.push({
          attachment: {
            filename: item.metadata.originalName,
            contentType: item.metadata.contentType,
            size: item.metadata.size,
            content: content
          },
          s3Params: {
            Bucket: config.BUCKET_NAME,
            Key: `${Date.now()}-${item.metadata.originalName}`,
            Body: content,
            ContentType: item.metadata.contentType
          },
          localPath: item.filepath
        });
      }
    }
    
    const toRetry = [...retryQueue];
    retryQueue.length = 0;
    
    for (const item of toRetry) {
      try {
        const result = await config.s3.upload(item.s3Params).promise();
        logger.info(`Successfully uploaded to S3 on retry: ${item.attachment.filename}`);
        
        // Remove local file after successful upload
        await localStorage.remove(item.localPath);
      } catch (error) {
        logger.error(`Retry failed for ${item.attachment.filename}, will retry again later`);
        retryQueue.push(item);
      }
    }
  }, retryIntervalMinutes * 60 * 1000);
  
  logger.info(`Started S3 retry process, checking every ${retryIntervalMinutes} minutes`);
}

// Check S3 connectivity
async function checkS3Health() {
  try {
    await config.s3.headBucket({ Bucket: config.BUCKET_NAME }).promise();
    return true;
  } catch (error) {
    logger.error('S3 health check failed:', error);
    return false;
  }
}

// Initialize retry process on startup for any persisted files
(async () => {
  const persistedQueue = await localStorage.getRetryQueue();
  if (persistedQueue.length > 0) {
    logger.info(`Found ${persistedQueue.length} files to retry uploading to S3`);
    startRetryProcess();
  }
})();

module.exports = { uploadToS3, checkS3Health };
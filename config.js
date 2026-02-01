const dotenv = require('dotenv');
const AWS = require('aws-sdk');

dotenv.config();

module.exports = {
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_RULES: process.env.WEBHOOK_RULES,
  PORT: process.env.PORT || 25,
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || 5 * 1024 * 1024,
  BUCKET_NAME: process.env.S3_BUCKET_NAME,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  WEBHOOK_CONCURRENCY: process.env.WEBHOOK_CONCURRENCY || 5,
  LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH || './temp-attachments',
  LOCAL_STORAGE_RETENTION: process.env.LOCAL_STORAGE_RETENTION || 24,
  S3_RETRY_INTERVAL: process.env.S3_RETRY_INTERVAL || 5,

  s3: new AWS.S3({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  })
};
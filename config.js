const dotenv = require('dotenv');
const { S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');

dotenv.config();

// Helper function to parse integers with fallback
function parseIntEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Create S3 client only if credentials are configured
function createS3Client() {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  // Return null if S3 is not configured
  if (!region || !accessKeyId || !secretAccessKey) {
    return null;
  }
  
  const config = {
    region: region,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    }
  };
  
  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
  }
  
  if (process.env.S3_FORCE_PATH_STYLE === 'true') {
    config.forcePathStyle = true;
  }
  
  return new S3Client(config);
}

// Load TLS certificates if secure mode is enabled
function loadTLSConfig() {
  if (process.env.SMTP_SECURE !== 'true') {
    return null;
  }
  
  const keyPath = process.env.TLS_KEY_PATH;
  const certPath = process.env.TLS_CERT_PATH;
  
  if (!keyPath || !certPath) {
    return { error: 'TLS_KEY_PATH and TLS_CERT_PATH are required when SMTP_SECURE=true' };
  }
  
  try {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (error) {
    return { error: `Failed to load TLS certificates: ${error.message}` };
  }
}

const tlsConfig = loadTLSConfig();

module.exports = {
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_RULES: process.env.WEBHOOK_RULES,
  PORT: parseIntEnv(process.env.PORT, 25),
  MAX_FILE_SIZE: parseIntEnv(process.env.MAX_FILE_SIZE, 5 * 1024 * 1024),
  BUCKET_NAME: process.env.S3_BUCKET_NAME,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  WEBHOOK_CONCURRENCY: parseIntEnv(process.env.WEBHOOK_CONCURRENCY, 5),
  WEBHOOK_TIMEOUT: parseIntEnv(process.env.WEBHOOK_TIMEOUT, 5000),
  LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH || './temp-attachments',
  LOCAL_STORAGE_RETENTION: parseIntEnv(process.env.LOCAL_STORAGE_RETENTION, 24),
  S3_RETRY_INTERVAL: parseIntEnv(process.env.S3_RETRY_INTERVAL, 5),
  S3_MAX_RETRIES: parseIntEnv(process.env.S3_MAX_RETRIES, 100),
  
  // TLS configuration
  TLS: tlsConfig,
  
  // S3 client (null if not configured)
  s3: createS3Client(),
  
  // Helper to check if S3 is configured
  isS3Configured() {
    return this.s3 !== null && this.BUCKET_NAME;
  }
};
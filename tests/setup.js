// Suppress AWS SDK maintenance mode warning during tests
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

// Set test environment
process.env.NODE_ENV = 'test';
process.env.WEBHOOK_URL = 'https://test.webhook.com';
process.env.PORT = '2525';
process.env.MAX_FILE_SIZE = '5242880';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
process.env.SMTP_SECURE = 'false';
process.env.WEBHOOK_CONCURRENCY = '5';
process.env.LOCAL_STORAGE_PATH = './test-temp-attachments';
process.env.LOCAL_STORAGE_RETENTION = '1';
process.env.S3_RETRY_INTERVAL = '1';

// Mock winston logger to reduce test output noise
jest.mock('winston', () => {
  const originalWinston = jest.requireActual('winston');
  return {
    ...originalWinston,
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  };
});

// Clean up test files after all tests
afterAll(async () => {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    await fs.rm(path.join(__dirname, '..', 'test-temp-attachments'), { recursive: true, force: true });
  } catch (error) {
    // Directory might not exist
  }
});
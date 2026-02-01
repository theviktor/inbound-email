describe('Configuration', () => {
  beforeEach(() => {
    // Clear module cache to ensure fresh config load
    jest.resetModules();
  });

  it('should load configuration with defaults', () => {
    const config = require('../config');

    expect(config.WEBHOOK_URL).toBe('https://test.webhook.com');
    expect(config.PORT).toBe('2525');
    expect(config.MAX_FILE_SIZE).toBe('5242880');
    expect(config.BUCKET_NAME).toBe('test-bucket');
    expect(config.SMTP_SECURE).toBe(false);
    expect(config.WEBHOOK_CONCURRENCY).toBe('5');
  });

  it('should have AWS S3 client configured', () => {
    const config = require('../config');
    
    expect(config.s3).toBeDefined();
    expect(typeof config.s3.upload).toBe('function');
    expect(typeof config.s3.headBucket).toBe('function');
  });

  it('should parse SMTP_SECURE as boolean', () => {
    process.env.SMTP_SECURE = 'true';
    jest.resetModules();
    const config = require('../config');
    expect(config.SMTP_SECURE).toBe(true);

    process.env.SMTP_SECURE = 'false';
    jest.resetModules();
    const config2 = require('../config');
    expect(config2.SMTP_SECURE).toBe(false);
  });

  it('should use environment variables when set', () => {
    process.env.WEBHOOK_URL = 'https://custom.webhook.com';
    process.env.PORT = '3000';
    process.env.MAX_FILE_SIZE = '10485760';
    
    jest.resetModules();
    const config = require('../config');

    expect(config.WEBHOOK_URL).toBe('https://custom.webhook.com');
    expect(config.PORT).toBe('3000');
    expect(config.MAX_FILE_SIZE).toBe('10485760');
  });

  it('should configure S3 with custom endpoint and path style', () => {
    process.env.S3_ENDPOINT = 'http://minio:9000';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    
    jest.resetModules();
    const config = require('../config');

    expect(config.s3.config.endpoint).toBe('http://minio:9000');
    expect(config.s3.config.s3ForcePathStyle).toBe(true);

    // Clean up
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_FORCE_PATH_STYLE;
  });
});
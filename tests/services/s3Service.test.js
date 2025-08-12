const { uploadToS3, checkS3Health } = require('../../services/s3Service');
const config = require('../../config');

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  S3: jest.fn(() => ({
    upload: jest.fn(() => ({
      promise: jest.fn()
    })),
    headBucket: jest.fn(() => ({
      promise: jest.fn()
    }))
  }))
}));

// Mock LocalStorage
jest.mock('../../services/localStorage', () => {
  return jest.fn().mockImplementation(() => ({
    save: jest.fn(),
    getRetryQueue: jest.fn().mockResolvedValue([]),
    remove: jest.fn()
  }));
});

describe('S3 Service', () => {
  let mockS3Upload;
  let mockS3HeadBucket;
  let mockLocalStorageSave;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockS3Upload = jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Location: 'https://s3.amazonaws.com/test-bucket/test-file.pdf' })
    });
    
    mockS3HeadBucket = jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });
    
    config.s3.upload = mockS3Upload;
    config.s3.headBucket = mockS3HeadBucket;
    
    const LocalStorage = require('../../services/localStorage');
    const localStorageInstance = new LocalStorage();
    mockLocalStorageSave = localStorageInstance.save;
  });

  describe('uploadToS3', () => {
    it('should upload small attachment to S3', async () => {
      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      const result = await uploadToS3(attachment);

      expect(result.storageType).toBe('s3');
      expect(result.location).toBe('https://s3.amazonaws.com/test-bucket/test-file.pdf');
      expect(mockS3Upload).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: config.BUCKET_NAME,
          Body: attachment.content,
          ContentType: attachment.contentType
        })
      );
    });

    it('should skip large attachments', async () => {
      const attachment = {
        filename: 'large.pdf',
        contentType: 'application/pdf',
        size: 10 * 1024 * 1024, // 10MB
        content: Buffer.from('large content')
      };

      const result = await uploadToS3(attachment);

      expect(result.storageType).toBe('skipped');
      expect(result.location).toBeNull();
      expect(mockS3Upload).not.toHaveBeenCalled();
    });

    it('should fallback to local storage on S3 error', async () => {
      mockS3Upload.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('S3 Error'))
      });

      mockLocalStorageSave.mockResolvedValue({
        success: true,
        location: '/temp-attachments/test.pdf',
        storageType: 'local',
        metadata: {
          originalName: 'test.pdf',
          size: 1024
        }
      });

      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      const result = await uploadToS3(attachment);

      expect(result.storageType).toBe('local');
      expect(result.location).toBe('/temp-attachments/test.pdf');
      expect(mockLocalStorageSave).toHaveBeenCalledWith(attachment);
    });

    it('should throw error if both S3 and local storage fail', async () => {
      mockS3Upload.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('S3 Error'))
      });

      mockLocalStorageSave.mockResolvedValue({
        success: false,
        error: 'Local storage error'
      });

      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      await expect(uploadToS3(attachment)).rejects.toThrow('Both S3 and local storage failed');
    });
  });

  describe('checkS3Health', () => {
    it('should return true when S3 is accessible', async () => {
      const result = await checkS3Health();
      
      expect(result).toBe(true);
      expect(mockS3HeadBucket).toHaveBeenCalledWith({ Bucket: config.BUCKET_NAME });
    });

    it('should return false when S3 is not accessible', async () => {
      mockS3HeadBucket.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('Bucket not found'))
      });

      const result = await checkS3Health();
      
      expect(result).toBe(false);
    });
  });
});
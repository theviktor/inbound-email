const { Upload } = require('@aws-sdk/lib-storage');
const config = require('../../config');

// Mock AWS SDK v3
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn()
  })),
  HeadBucketCommand: jest.fn()
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn()
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
  let mockUploadDone;
  let mockS3Send;
  let mockLocalStorageSave;
  let s3Service;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mocks
    mockS3Send = jest.fn().mockResolvedValue({});
    config.s3.send = mockS3Send;

    mockUploadDone = jest.fn().mockResolvedValue({ Location: 'https://s3.amazonaws.com/test-bucket/test-file.pdf' });
    Upload.mockImplementation(() => ({
      done: mockUploadDone
    }));
    
    // Require service
    s3Service = require('../../services/s3Service');
    
    // Get the exposed localStorage mock
    mockLocalStorageSave = s3Service.localStorage.save;
  });

  describe('uploadToS3', () => {
    it('should upload small attachment to S3', async () => {
      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      const result = await s3Service.uploadToS3(attachment);

      expect(result.storageType).toBe('s3');
      expect(result.location).toBe('https://s3.amazonaws.com/test-bucket/test-file.pdf');
      
      expect(Upload).toHaveBeenCalledWith(
        expect.objectContaining({
          client: config.s3,
          params: expect.objectContaining({
            Bucket: config.BUCKET_NAME,
            Body: attachment.content,
            ContentType: attachment.contentType
          })
        })
      );
      expect(mockUploadDone).toHaveBeenCalled();
    });

    it('should skip large attachments', async () => {
      const attachment = {
        filename: 'large.pdf',
        contentType: 'application/pdf',
        size: 10 * 1024 * 1024, // 10MB
        content: Buffer.from('large content')
      };

      const result = await s3Service.uploadToS3(attachment);

      expect(result.storageType).toBe('skipped');
      expect(result.location).toBeNull();
      expect(Upload).not.toHaveBeenCalled();
    });

    it('should fallback to local storage on S3 error', async () => {
      mockUploadDone.mockRejectedValue(new Error('S3 Error'));

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

      const result = await s3Service.uploadToS3(attachment);

      expect(result.storageType).toBe('local');
      expect(result.location).toBe('/temp-attachments/test.pdf');
      expect(mockLocalStorageSave).toHaveBeenCalledWith(attachment);
    });

    it('should throw error if both S3 and local storage fail', async () => {
      mockUploadDone.mockRejectedValue(new Error('S3 Error'));

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

      await expect(s3Service.uploadToS3(attachment)).rejects.toThrow('Both S3 and local storage failed');
    });
  });

  describe('checkS3Health', () => {
    it('should return true when S3 is accessible', async () => {
      const result = await s3Service.checkS3Health();
      
      expect(result).toBe(true);
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should return false when S3 is not accessible', async () => {
      mockS3Send.mockRejectedValue(new Error('Bucket not found'));

      const result = await s3Service.checkS3Health();
      
      expect(result).toBe(false);
    });
  });
});
const { parseEmail } = require('../../services/emailParser');
const { Readable } = require('stream');

// Mock mailparser
jest.mock('mailparser', () => ({
  simpleParser: jest.fn()
}));

// Mock s3Service
jest.mock('../../services/s3Service', () => ({
  uploadToS3: jest.fn()
}));

describe('Email Parser Service', () => {
  const { simpleParser } = require('mailparser');
  const { uploadToS3 } = require('../../services/s3Service');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should parse email without attachments', async () => {
    const mockParsedEmail = {
      from: { text: 'sender@example.com' },
      to: { text: 'recipient@example.com' },
      subject: 'Test Email',
      text: 'This is a test email',
      html: '<p>This is a test email</p>',
      attachments: []
    };

    simpleParser.mockResolvedValue(mockParsedEmail);

    const stream = Readable.from('test email content');
    const result = await parseEmail(stream);

    expect(result.from.text).toBe('sender@example.com');
    expect(result.subject).toBe('Test Email');
    expect(result.attachmentInfo).toEqual([]);
    expect(result.skippedAttachments).toEqual([]);
    expect(result.storageSummary).toBeUndefined();
  });

  it('should process email with S3 attachments', async () => {
    const mockParsedEmail = {
      from: { text: 'sender@example.com' },
      subject: 'Email with Attachments',
      attachments: [
        {
          filename: 'document.pdf',
          contentType: 'application/pdf',
          size: 1024,
          content: Buffer.from('pdf content')
        },
        {
          filename: 'image.jpg',
          contentType: 'image/jpeg',
          size: 2048,
          content: Buffer.from('image content')
        }
      ]
    };

    simpleParser.mockResolvedValue(mockParsedEmail);
    
    uploadToS3
      .mockResolvedValueOnce({
        location: 'https://s3.amazonaws.com/bucket/document.pdf',
        storageType: 's3'
      })
      .mockResolvedValueOnce({
        location: 'https://s3.amazonaws.com/bucket/image.jpg',
        storageType: 's3'
      });

    const stream = Readable.from('test email content');
    const result = await parseEmail(stream);

    expect(result.attachmentInfo).toHaveLength(2);
    expect(result.attachmentInfo[0]).toEqual({
      filename: 'document.pdf',
      contentType: 'application/pdf',
      size: 1024,
      location: 'https://s3.amazonaws.com/bucket/document.pdf',
      storageType: 's3'
    });
    
    expect(result.storageSummary).toEqual({
      total: 2,
      uploadedToS3: 2,
      storedLocally: 0,
      skipped: 0
    });
  });

  it('should handle local storage fallback', async () => {
    const mockParsedEmail = {
      from: { text: 'sender@example.com' },
      subject: 'Email with Local Storage',
      attachments: [
        {
          filename: 'document.pdf',
          contentType: 'application/pdf',
          size: 1024,
          content: Buffer.from('pdf content')
        }
      ]
    };

    simpleParser.mockResolvedValue(mockParsedEmail);
    
    uploadToS3.mockResolvedValue({
      location: '/temp-attachments/document.pdf',
      storageType: 'local',
      metadata: {
        fileId: '1234-document.pdf',
        originalName: 'document.pdf',
        size: 1024,
        savedAt: '2024-01-01T00:00:00Z'
      }
    });

    const stream = Readable.from('test email content');
    const result = await parseEmail(stream);

    expect(result.attachmentInfo).toHaveLength(1);
    expect(result.attachmentInfo[0]).toEqual({
      filename: 'document.pdf',
      contentType: 'application/pdf',
      size: 1024,
      location: null,
      storageType: 'local',
      note: 'Temporarily stored locally, will be uploaded to S3 when available',
      attachmentId: '1234-document.pdf'
    });
    
    expect(result.storageSummary).toEqual({
      total: 1,
      uploadedToS3: 0,
      storedLocally: 1,
      skipped: 0
    });
  });

  it('should handle skipped attachments', async () => {
    const mockParsedEmail = {
      from: { text: 'sender@example.com' },
      subject: 'Email with Large Attachment',
      attachments: [
        {
          filename: 'huge-file.zip',
          contentType: 'application/zip',
          size: 20 * 1024 * 1024, // 20MB
          content: Buffer.from('huge content')
        },
        {
          filename: 'small.txt',
          contentType: 'text/plain',
          size: 100,
          content: Buffer.from('small content')
        }
      ]
    };

    simpleParser.mockResolvedValue(mockParsedEmail);
    
    uploadToS3
      .mockResolvedValueOnce({
        location: null,
        storageType: 'skipped'
      })
      .mockResolvedValueOnce({
        location: 'https://s3.amazonaws.com/bucket/small.txt',
        storageType: 's3'
      });

    const stream = Readable.from('test email content');
    const result = await parseEmail(stream);

    expect(result.attachmentInfo).toHaveLength(1);
    expect(result.attachmentInfo[0].filename).toBe('small.txt');
    
    expect(result.skippedAttachments).toHaveLength(1);
    expect(result.skippedAttachments[0]).toEqual({
      filename: 'huge-file.zip',
      size: 20 * 1024 * 1024,
      reason: 'File size exceeds maximum allowed'
    });
    
    expect(result.storageSummary).toEqual({
      total: 2,
      uploadedToS3: 1,
      storedLocally: 0,
      skipped: 1
    });
  });

  it('should handle mixed storage types', async () => {
    const mockParsedEmail = {
      from: { text: 'sender@example.com' },
      subject: 'Mixed Storage Email',
      attachments: [
        {
          filename: 'doc1.pdf',
          contentType: 'application/pdf',
          size: 1024,
          content: Buffer.from('content1')
        },
        {
          filename: 'doc2.pdf',
          contentType: 'application/pdf',
          size: 2048,
          content: Buffer.from('content2')
        },
        {
          filename: 'huge.zip',
          contentType: 'application/zip',
          size: 10 * 1024 * 1024,
          content: Buffer.from('huge')
        }
      ]
    };

    simpleParser.mockResolvedValue(mockParsedEmail);
    
    uploadToS3
      .mockResolvedValueOnce({
        location: 'https://s3.amazonaws.com/bucket/doc1.pdf',
        storageType: 's3'
      })
      .mockResolvedValueOnce({
        location: '/temp-attachments/doc2.pdf',
        storageType: 'local',
        metadata: { originalName: 'doc2.pdf', size: 2048 }
      })
      .mockResolvedValueOnce({
        location: null,
        storageType: 'skipped'
      });

    const stream = Readable.from('test email content');
    const result = await parseEmail(stream);

    expect(result.storageSummary).toEqual({
      total: 3,
      uploadedToS3: 1,
      storedLocally: 1,
      skipped: 1
    });
  });
});

const fs = require('fs').promises;
const path = require('path');
const LocalStorage = require('../../services/localStorage');

describe('LocalStorage Service', () => {
  let localStorage;
  const testConfig = {
    LOCAL_STORAGE_PATH: './test-temp-attachments',
    LOCAL_STORAGE_RETENTION: 1
  };

  beforeEach(async () => {
    // Clean up before each test
    try {
      await fs.rm(testConfig.LOCAL_STORAGE_PATH, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist
    }
    
    const LocalStorage = require('../../services/localStorage');
    
    // Mock startCleanupTask to avoid background interference
    jest.spyOn(LocalStorage.prototype, 'startCleanupTask').mockImplementation(() => {});
    
    localStorage = new LocalStorage(testConfig);
    // Properly wait for initialization using ensureInitialized
    await localStorage.ensureInitialized();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Clean up after each test
    if (localStorage && localStorage.cleanupInterval) {
      clearInterval(localStorage.cleanupInterval);
    }
  });

  describe('save', () => {
    it('should save attachment to local storage', async () => {
      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      const result = await localStorage.save(attachment);

      expect(result.success).toBe(true);
      expect(result.storageType).toBe('local');
      expect(result.location).toContain('test.pdf');
      
      // Verify file exists
      const fileExists = await fs.stat(result.location)
        .then(() => true)
        .catch((err) => {
            console.error('File stat failed:', err);
            return false;
        });
      expect(fileExists).toBe(true);
      
      // Verify metadata file exists
      const metaExists = await fs.stat(`${result.location}.meta`).then(() => true).catch(() => false);
      expect(metaExists).toBe(true);
    });

    it('should handle save errors gracefully', async () => {
      // Make the directory read-only to force an error
      await fs.mkdir(testConfig.LOCAL_STORAGE_PATH, { recursive: true });
      await fs.chmod(testConfig.LOCAL_STORAGE_PATH, 0o444);

      const attachment = {
        filename: 'test.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('test content')
      };

      const result = await localStorage.save(attachment);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Reset permissions
      await fs.chmod(testConfig.LOCAL_STORAGE_PATH, 0o755);
    });

    it('should encrypt attachment content at rest when key is configured', async () => {
      const encryptedConfig = {
        ...testConfig,
        LOCAL_STORAGE_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      };
      const encryptedStorage = new LocalStorage(encryptedConfig);
      await encryptedStorage.ensureInitialized();

      const attachment = {
        filename: 'secret.txt',
        contentType: 'text/plain',
        size: 11,
        content: Buffer.from('hello world')
      };

      const result = await encryptedStorage.save(attachment);
      const rawOnDisk = await fs.readFile(result.location);
      const decrypted = await encryptedStorage.read(result.location);

      expect(rawOnDisk.equals(Buffer.from('hello world'))).toBe(false);
      expect(decrypted.equals(Buffer.from('hello world'))).toBe(true);
      expect(result.metadata.encrypted).toBe(true);
    });
  });

  describe('generateFilename', () => {
    it('should generate unique filenames', () => {
      const filename1 = localStorage.generateFilename('test.pdf');
      const filename2 = localStorage.generateFilename('test.pdf');

      expect(filename1).not.toBe(filename2);
      expect(filename1).toContain('test.pdf');
      expect(filename1).toMatch(/^\d+-[a-f0-9]{16}-test\.pdf$/);
    });

    it('should preserve file extensions', () => {
      const filename = localStorage.generateFilename('document.docx');
      expect(filename).toMatch(/\.docx$/);
    });
  });

  describe('cleanup', () => {
    it('should remove old files', async () => {
      const attachment = {
        filename: 'old-file.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('old content')
      };

      const result = await localStorage.save(attachment);
      const filepath = result.location;

      // Modify file time to be older than retention period
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours old
      await fs.utimes(filepath, oldTime, oldTime);
      await fs.utimes(`${filepath}.meta`, oldTime, oldTime);

      await localStorage.cleanup();

      // Verify files are removed
      const fileExists = await fs.stat(filepath).then(() => true).catch(() => false);
      const metaExists = await fs.stat(`${filepath}.meta`).then(() => true).catch(() => false);
      
      expect(fileExists).toBe(false);
      expect(metaExists).toBe(false);
    });

    it('should keep recent files', async () => {
      const attachment = {
        filename: 'recent-file.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('recent content')
      };

      const result = await localStorage.save(attachment);
      const filepath = result.location;

      await localStorage.cleanup();

      // Verify files still exist
      const fileExists = await fs.stat(filepath).then(() => true).catch(() => false);
      const metaExists = await fs.stat(`${filepath}.meta`).then(() => true).catch(() => false);
      
      expect(fileExists).toBe(true);
      expect(metaExists).toBe(true);
    });
  });

  describe('getRetryQueue', () => {
    it('should return list of files for retry', async () => {
      const attachment1 = {
        filename: 'file1.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('content 1')
      };

      const attachment2 = {
        filename: 'file2.jpg',
        contentType: 'image/jpeg',
        size: 2048,
        content: Buffer.from('content 2')
      };

      await localStorage.save(attachment1);
      await localStorage.save(attachment2);

      const queue = await localStorage.getRetryQueue();

      expect(queue).toHaveLength(2);
      expect(queue[0].metadata.originalName).toMatch(/file[12]\.(pdf|jpg)/);
      expect(queue[1].metadata.originalName).toMatch(/file[12]\.(pdf|jpg)/);
    });

    it('should handle orphaned metadata files', async () => {
      // Create orphaned metadata file without data file
      const metaPath = path.join(testConfig.LOCAL_STORAGE_PATH, 'orphaned.pdf.meta');
      const metadata = {
        originalName: 'orphaned.pdf',
        contentType: 'application/pdf',
        size: 1024,
        savedAt: new Date().toISOString(),
        filepath: path.join(testConfig.LOCAL_STORAGE_PATH, 'orphaned.pdf')
      };
      
      await fs.mkdir(testConfig.LOCAL_STORAGE_PATH, { recursive: true });
      await fs.writeFile(metaPath, JSON.stringify(metadata));

      const queue = await localStorage.getRetryQueue();

      expect(queue).toHaveLength(0);
      
      // Verify orphaned meta file is removed
      const metaExists = await fs.stat(metaPath).then(() => true).catch(() => false);
      expect(metaExists).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove file and its metadata', async () => {
      const attachment = {
        filename: 'to-remove.pdf',
        contentType: 'application/pdf',
        size: 1024,
        content: Buffer.from('content to remove')
      };

      const result = await localStorage.save(attachment);
      const filepath = result.location;

      await localStorage.remove(filepath);

      const fileExists = await fs.stat(filepath).then(() => true).catch(() => false);
      const metaExists = await fs.stat(`${filepath}.meta`).then(() => true).catch(() => false);
      
      expect(fileExists).toBe(false);
      expect(metaExists).toBe(false);
    });

    it('should handle removal errors gracefully', async () => {
      // Try to remove non-existent file
      await localStorage.remove('/non/existent/file.pdf');
      // Should not throw, just log error
    });
  });
});

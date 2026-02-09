const { sendToWebhook } = require('../../services/webhookService');
const config = require('../../config');
const axios = require('axios');

jest.mock('axios');

describe('Webhook Service', () => {
  let originalWebhookSecret;

  beforeAll(() => {
    originalWebhookSecret = config.WEBHOOK_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    config.WEBHOOK_SECRET = '';
  });

  afterAll(() => {
    config.WEBHOOK_SECRET = originalWebhookSecret;
  });

  it('should send data to webhook successfully', async () => {
    const mockResponse = { data: { success: true }, status: 200 };
    axios.post.mockResolvedValue(mockResponse);

    const testData = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Email',
      text: 'Test content'
    };

    await sendToWebhook(testData);

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.webhook.com',
      expect.objectContaining({
        ...testData,
        _webhookMeta: expect.objectContaining({
          webhook: 'https://test.webhook.com',
          ruleName: 'default',
          priority: 9999
        })
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'inbound-email-service/1.0'
        })
      })
    );
  });

  it('should handle webhook timeout', async () => {
    const timeoutError = new Error('timeout of 5000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValue(timeoutError);

    const testData = { subject: 'Test' };

    await expect(sendToWebhook(testData)).rejects.toThrow('All 1 webhook(s) failed');
    expect(axios.post).toHaveBeenCalledWith(
      'https://test.webhook.com',
      expect.anything(),
      expect.anything()
    );
  });

  it('should handle webhook server errors', async () => {
    const serverError = new Error('Request failed with status code 500');
    serverError.response = {
      status: 500,
      data: { error: 'Internal Server Error' }
    };
    axios.post.mockRejectedValue(serverError);

    const testData = { subject: 'Test' };

    await expect(sendToWebhook(testData)).rejects.toThrow('All 1 webhook(s) failed');
  });

  it('should handle network errors', async () => {
    const networkError = new Error('Network Error');
    networkError.code = 'ENOTFOUND';
    axios.post.mockRejectedValue(networkError);

    const testData = { subject: 'Test' };

    await expect(sendToWebhook(testData)).rejects.toThrow('All 1 webhook(s) failed');
  });

  it('should send large payloads', async () => {
    const mockResponse = { data: { success: true }, status: 200 };
    axios.post.mockResolvedValue(mockResponse);

    const largeData = {
      subject: 'Large Email',
      attachmentInfo: Array(100).fill({
        filename: 'file.pdf',
        size: 1024,
        location: 'https://s3.amazonaws.com/bucket/file.pdf'
      })
    };

    await sendToWebhook(largeData);

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.webhook.com',
      expect.objectContaining({
        ...largeData,
        _webhookMeta: expect.objectContaining({
          webhook: 'https://test.webhook.com'
        })
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('should add webhook signature headers when secret is configured', async () => {
    const mockResponse = { data: { success: true }, status: 200 };
    axios.post.mockResolvedValue(mockResponse);
    config.WEBHOOK_SECRET = 'test-secret';

    await sendToWebhook({ subject: 'Signed Email' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.webhook.com',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Inbound-Email-Signature': expect.stringMatching(/^sha256=/),
          'X-Inbound-Email-Timestamp': expect.any(String),
          'X-Inbound-Email-Signature-Version': 'v1'
        })
      })
    );
  });
});

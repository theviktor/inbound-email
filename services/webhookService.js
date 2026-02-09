const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const WebhookRouter = require('./webhookRouter');
const logger = require('./logger');

const webhookRouter = new WebhookRouter(config);

function buildSignatureHeaders(payload) {
  if (!config.WEBHOOK_SECRET) {
    return {};
  }

  const timestamp = Date.now().toString();
  const payloadJson = JSON.stringify(payload);
  const signed = `${timestamp}.${payloadJson}`;
  const signature = crypto
    .createHmac('sha256', config.WEBHOOK_SECRET)
    .update(signed)
    .digest('hex');

  return {
    'X-Inbound-Email-Timestamp': timestamp,
    'X-Inbound-Email-Signature': `sha256=${signature}`,
    'X-Inbound-Email-Signature-Version': 'v1'
  };
}

function summarizeResponseData(data) {
  if (data === undefined || data === null) {
    return undefined;
  }
  if (typeof data === 'string') {
    return `[string length=${data.length}]`;
  }
  if (typeof data === 'object') {
    return `[object keys=${Object.keys(data).slice(0, 20).join(',')}]`;
  }
  return `[${typeof data}]`;
}

async function sendToWebhook(data, retryOnlyFailed = null) {
  // Get matching webhooks based on routing rules
  let matchedWebhooks = webhookRouter.route(data);
  
  if (matchedWebhooks.length === 0) {
    throw new Error('No webhook endpoints found for this email');
  }

  // If retrying, only send to previously failed webhooks
  if (retryOnlyFailed && Array.isArray(retryOnlyFailed)) {
    matchedWebhooks = matchedWebhooks.filter(m => 
      retryOnlyFailed.includes(m.webhook)
    );
    if (matchedWebhooks.length === 0) {
      // All previously failed webhooks have been removed from config
      return {
        totalWebhooks: 0,
        successful: 0,
        failed: 0,
        results: [],
        note: 'No matching webhooks found for retry'
      };
    }
  }

  const results = [];
  const errors = [];
  const timeout = config.WEBHOOK_TIMEOUT;

  // Send to all matched webhooks
  for (const match of matchedWebhooks) {
    try {
      logger.info(`Sending to webhook: ${match.webhook} (rule: ${match.ruleName})`);
      
      const payload = {
        ...data,
        _webhookMeta: {
          ruleName: match.ruleName,
          priority: match.priority,
          webhook: match.webhook
        }
      };

      const response = await axios.post(match.webhook, payload, { 
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'inbound-email-service/1.0',
          ...buildSignatureHeaders(payload)
        }
      });

      results.push({
        webhook: match.webhook,
        ruleName: match.ruleName,
        status: response.status,
        success: true
      });

      logger.info(`Successfully sent to ${match.webhook} (${response.status})`);
      
    } catch (error) {
      const errorInfo = {
        webhook: match.webhook,
        ruleName: match.ruleName,
        success: false,
        error: error.message,
        status: error.response?.status || null
      };

      results.push(errorInfo);
      errors.push(errorInfo);
      
      logger.error(`Failed to send to ${match.webhook}:`, {
        error: error.message,
        status: error.response?.status,
        responseData: summarizeResponseData(error.response?.data)
      });
    }
  }

  // If all webhooks failed, throw an error with failed webhooks list for retry
  if (errors.length === matchedWebhooks.length) {
    const error = new Error(`All ${matchedWebhooks.length} webhook(s) failed`);
    error.results = results;
    error.failedWebhooks = errors.map(e => e.webhook);
    throw error;
  }

  // Return results for partial success scenarios
  // Include failed webhooks list so caller can decide to retry just those
  return {
    totalWebhooks: matchedWebhooks.length,
    successful: results.filter(r => r.success).length,
    failed: errors.length,
    results: results,
    failedWebhooks: errors.map(e => e.webhook)
  };
}

// Legacy function for backward compatibility
function sendToSingleWebhook(data, webhookUrl = config.WEBHOOK_URL) {
  return axios.post(webhookUrl, data, { 
    timeout: config.WEBHOOK_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'inbound-email-service/1.0'
    }
  });
}

// Health check function for webhooks
async function checkWebhookHealth(webhookUrl) {
  try {
    const response = await axios.get(webhookUrl, { 
      timeout: config.WEBHOOK_TIMEOUT,
      validateStatus: (status) => status < 500 // Accept any status code < 500
    });
    return { healthy: true, status: response.status };
  } catch (error) {
    return { 
      healthy: false, 
      error: error.message,
      status: error.response?.status || null
    };
  }
}

// Get all configured webhooks for health monitoring
function getAllWebhooks() {
  return webhookRouter.getAllWebhooks();
}

module.exports = { 
  sendToWebhook, 
  sendToSingleWebhook, 
  checkWebhookHealth,
  getAllWebhooks 
};

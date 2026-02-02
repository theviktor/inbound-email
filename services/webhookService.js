const axios = require('axios');
const config = require('../config');
const WebhookRouter = require('./webhookRouter');
const logger = require('./logger');

const webhookRouter = new WebhookRouter(config);

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
      
      const response = await axios.post(match.webhook, {
        ...data,
        _webhookMeta: {
          ruleName: match.ruleName,
          priority: match.priority,
          webhook: match.webhook
        }
      }, { 
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'inbound-email-service/1.0'
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
        data: error.response?.data
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
const axios = require('axios');
const config = require('../config');
const WebhookRouter = require('./webhookRouter');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

const webhookRouter = new WebhookRouter(config);

async function sendToWebhook(data) {
  // Get matching webhooks based on routing rules
  const matchedWebhooks = webhookRouter.route(data);
  
  if (matchedWebhooks.length === 0) {
    throw new Error('No webhook endpoints found for this email');
  }

  const results = [];
  const errors = [];

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
        timeout: 5000,
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

  // If all webhooks failed, throw an error
  if (errors.length === matchedWebhooks.length) {
    const error = new Error(`All ${matchedWebhooks.length} webhook(s) failed`);
    error.results = results;
    throw error;
  }

  // Return results for partial success scenarios
  return {
    totalWebhooks: matchedWebhooks.length,
    successful: results.filter(r => r.success).length,
    failed: errors.length,
    results: results
  };
}

// Legacy function for backward compatibility
function sendToSingleWebhook(data, webhookUrl = config.WEBHOOK_URL) {
  return axios.post(webhookUrl, data, { 
    timeout: 5000,
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
      timeout: 5000,
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
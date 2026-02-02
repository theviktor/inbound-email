const SMTPServer = require('smtp-server').SMTPServer;
const config = require('./config');
const { parseEmail } = require('./services/emailParser');
const { sendToWebhook } = require('./services/webhookService');
const Queue = require('better-queue');
const logger = require('./services/logger');

// Validate configuration BEFORE any component initialization
function validateConfig() {
  const errors = [];
  
  // Check required keys
  if (!config.WEBHOOK_URL && !config.WEBHOOK_RULES) {
    errors.push('Either WEBHOOK_URL or WEBHOOK_RULES must be configured');
  }
  
  if (typeof config.PORT !== 'number' || config.PORT <= 0) {
    errors.push('PORT must be a valid positive number');
  }
  
  if (typeof config.WEBHOOK_CONCURRENCY !== 'number' || config.WEBHOOK_CONCURRENCY <= 0) {
    errors.push('WEBHOOK_CONCURRENCY must be a valid positive number');
  }
  
  // Check TLS configuration if secure mode is enabled
  if (config.SMTP_SECURE && config.TLS && config.TLS.error) {
    errors.push(config.TLS.error);
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}

// Validate configuration immediately
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration error:', { message: error.message });
  process.exit(1);
}

const webhookQueue = new Queue(async function (task, cb) {
  const { parsed, failedWebhooks } = task;
  const maxRetries = 3;
  let retries = 0;

  const attemptWebhook = async () => {
    try {
      const result = await sendToWebhook(parsed, failedWebhooks);
      logger.info('Successfully sent to webhook', { 
        successful: result.successful, 
        failed: result.failed 
      });
      cb(null, result);
    } catch (error) {
      logger.error('Webhook error:', { message: error.message, stack: error.stack });
      if (error.response) {
        logger.error('Webhook response error:', { 
          status: error.response.status, 
          data: error.response.data 
        });
      }
      retries++;
      if (retries < maxRetries) {
        logger.info(`Retrying webhook (attempt ${retries}/${maxRetries})`);
        // Use exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
        setTimeout(() => {
          attemptWebhook().catch(err => cb(err));
        }, delay);
      } else {
        cb(error);
      }
    }
  };

  attemptWebhook().catch(err => cb(err));
}, { concurrent: config.WEBHOOK_CONCURRENCY });

// Build SMTP server options
const smtpOptions = {
  onData(stream, session, callback) {
    parseEmail(stream)
      .then(parsed => {
        webhookQueue.push({ parsed, failedWebhooks: null });
        logger.info('Email added to queue', { queueSize: webhookQueue.getStats().total });
        callback();
      })
      .catch(error => {
        logger.error('Parsing error:', { message: error.message, stack: error.stack });
        callback(new Error('Failed to parse email'));
      });
  },
  onError(error) {
    logger.error('SMTP server error:', { message: error.message, stack: error.stack });
  },
  disabledCommands: ['AUTH'],
  secure: config.SMTP_SECURE
};

// Add TLS options if secure mode is enabled
if (config.SMTP_SECURE && config.TLS && !config.TLS.error) {
  smtpOptions.key = config.TLS.key;
  smtpOptions.cert = config.TLS.cert;
}

const server = new SMTPServer(smtpOptions);

server.listen(config.PORT, '0.0.0.0', err => {
  if (err) {
    logger.error('Failed to start SMTP server:', { message: err.message, stack: err.stack });
    process.exit(1);
  }
  logger.info(`SMTP server listening on port ${config.PORT} on all interfaces`);
});

let isShuttingDown = false;

function gracefulShutdown(reason) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  
  logger.info(`Shutting down: ${reason}`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('SMTP server closed, waiting for queue to drain...');
    
    // Check if queue is empty
    const checkQueue = () => {
      const stats = webhookQueue.getStats();
      if (stats.total === 0) {
        logger.info('Queue drained. Exiting process.');
        process.exit(0);
      } else {
        logger.info(`Waiting for ${stats.total} items in queue...`);
        setTimeout(checkQueue, 1000);
      }
    };
    
    // Give queue 30 seconds max to drain
    const forceExitTimeout = setTimeout(() => {
      const stats = webhookQueue.getStats();
      logger.warn(`Force exiting with ${stats.total} items still in queue`);
      process.exit(1);
    }, 30000);
    
    forceExitTimeout.unref();
    checkQueue();
  });
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', { message: err.message, stack: err.stack });
  gracefulShutdown('Uncaught exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason: reason, promise: promise });
  gracefulShutdown('Unhandled rejection');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM signal received');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT signal received');
});

// Export for testing
module.exports = { server, webhookQueue };
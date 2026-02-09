const SMTPServer = require('smtp-server').SMTPServer;
const config = require('./config');
const { parseEmail } = require('./services/emailParser');
const { sendToWebhook } = require('./services/webhookService');
const Queue = require('better-queue');
const logger = require('./services/logger');
const { isRecoverableNetworkError, serializeError } = require('./services/errorClassifier');
const DurableQueue = require('./services/durableQueue');
const { SlidingWindowRateLimiter } = require('./services/rateLimiter');
const {
  normalizeIp,
  isIpAllowed,
  isSenderDomainAllowed,
  hasRequiredAuthResults
} = require('./services/emailSecurity');

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

  if (typeof config.WEBHOOK_RETRY_DELAY_MS !== 'number' || config.WEBHOOK_RETRY_DELAY_MS <= 0) {
    errors.push('WEBHOOK_RETRY_DELAY_MS must be a valid positive number');
  }

  if (typeof config.SMTP_MAX_CLIENTS !== 'number' || config.SMTP_MAX_CLIENTS <= 0) {
    errors.push('SMTP_MAX_CLIENTS must be a valid positive number');
  }

  if (typeof config.SMTP_SOCKET_TIMEOUT !== 'number' || config.SMTP_SOCKET_TIMEOUT <= 0) {
    errors.push('SMTP_SOCKET_TIMEOUT must be a valid positive number');
  }

  if (typeof config.SMTP_CLOSE_TIMEOUT !== 'number' || config.SMTP_CLOSE_TIMEOUT <= 0) {
    errors.push('SMTP_CLOSE_TIMEOUT must be a valid positive number');
  }

  if (typeof config.SMTP_MAX_MESSAGE_SIZE !== 'number' || config.SMTP_MAX_MESSAGE_SIZE <= 0) {
    errors.push('SMTP_MAX_MESSAGE_SIZE must be a valid positive number');
  }

  if (typeof config.SMTP_RATE_LIMIT_WINDOW_MS !== 'number' || config.SMTP_RATE_LIMIT_WINDOW_MS <= 0) {
    errors.push('SMTP_RATE_LIMIT_WINDOW_MS must be a valid positive number');
  }

  if (typeof config.SMTP_RATE_LIMIT_MAX_CONNECTIONS !== 'number' || config.SMTP_RATE_LIMIT_MAX_CONNECTIONS <= 0) {
    errors.push('SMTP_RATE_LIMIT_MAX_CONNECTIONS must be a valid positive number');
  }

  if (typeof config.MAX_QUEUE_SIZE !== 'number' || config.MAX_QUEUE_SIZE <= 0) {
    errors.push('MAX_QUEUE_SIZE must be a valid positive number');
  }

  if (config.REQUIRE_TRUSTED_RELAY && config.TRUSTED_RELAY_IPS.length === 0) {
    errors.push('TRUSTED_RELAY_IPS must be configured when REQUIRE_TRUSTED_RELAY=true');
  }

  if (config.REQUIRED_AUTH_RESULTS.length > 0 && config.TRUSTED_RELAY_IPS.length === 0) {
    errors.push('TRUSTED_RELAY_IPS must be configured when REQUIRED_AUTH_RESULTS is used');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!config.REQUIRE_TRUSTED_RELAY) {
      errors.push('REQUIRE_TRUSTED_RELAY must be true in production');
    }
    if (config.TRUSTED_RELAY_IPS.length === 0) {
      errors.push('TRUSTED_RELAY_IPS must be configured in production');
    }
    if (config.ALLOWED_RECIPIENT_DOMAINS.length === 0) {
      errors.push('ALLOWED_RECIPIENT_DOMAINS must be configured in production');
    }
    if (!config.WEBHOOK_SECRET) {
      errors.push('WEBHOOK_SECRET must be configured in production');
    }
    if (config.ALLOW_INSECURE_WEBHOOK_HTTP) {
      errors.push('ALLOW_INSECURE_WEBHOOK_HTTP must be false in production');
    }
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

const durableQueue = new DurableQueue(config.DURABLE_QUEUE_PATH);
const connectionRateLimiter = new SlidingWindowRateLimiter({
  windowMs: config.SMTP_RATE_LIMIT_WINDOW_MS,
  maxHits: config.SMTP_RATE_LIMIT_MAX_CONNECTIONS
});

function createSmtpError(message, responseCode = 451) {
  const error = new Error(message);
  error.responseCode = responseCode;
  return error;
}

const webhookQueue = new Queue(async function (task, cb) {
  const { taskId } = task;
  if (!taskId) {
    cb(new Error('Missing durable task id'));
    return;
  }

  let queueItem;
  try {
    queueItem = await durableQueue.get(taskId);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('Durable queue item no longer exists, skipping', { taskId });
      cb();
      return;
    }
    cb(error);
    return;
  }

  const { parsed } = queueItem;
  let failedWebhooks = queueItem.failedWebhooks || null;
  const maxRetries = 3;
  let retries = 0;

  const attemptWebhook = async () => {
    try {
      const result = await sendToWebhook(parsed, failedWebhooks);
      await durableQueue.remove(taskId);
      logger.info('Successfully sent to webhook', {
        taskId,
        successful: result.successful, 
        failed: result.failed 
      });
      cb(null, result);
    } catch (error) {
      logger.error('Webhook error:', { taskId, message: error.message, stack: error.stack });
      if (Array.isArray(error.failedWebhooks) && error.failedWebhooks.length > 0) {
        failedWebhooks = error.failedWebhooks;
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
        try {
          await durableQueue.update(taskId, {
            failedWebhooks,
            lastError: error.message,
            attempts: (queueItem.attempts || 0) + retries
          });
        } catch (persistError) {
          logger.error('Failed to persist queue failure state', {
            taskId,
            message: persistError.message
          });
        }
        const retryTimer = setTimeout(() => {
          webhookQueue.push({ taskId });
        }, config.WEBHOOK_RETRY_DELAY_MS);
        retryTimer.unref();

        logger.warn('Queued durable task for delayed retry', {
          taskId,
          delayMs: config.WEBHOOK_RETRY_DELAY_MS
        });
        cb(null, { queuedForRetry: true });
      }
    }
  };

  attemptWebhook().catch(err => cb(err));
}, { concurrent: config.WEBHOOK_CONCURRENCY });

// Build SMTP server options
const smtpOptions = {
  onConnect(session, callback) {
    const remoteIp = normalizeIp(session.remoteAddress);

    if (!isIpAllowed(remoteIp, config.ALLOWED_SMTP_CLIENTS)) {
      logger.warn('Rejected SMTP client not in ALLOWED_SMTP_CLIENTS', { remoteIp });
      return callback(createSmtpError('SMTP client not allowed', 550));
    }

    if (config.REQUIRE_TRUSTED_RELAY && !isIpAllowed(remoteIp, config.TRUSTED_RELAY_IPS)) {
      logger.warn('Rejected SMTP client not in TRUSTED_RELAY_IPS', { remoteIp });
      return callback(createSmtpError('SMTP relay is not trusted', 550));
    }

    if (!connectionRateLimiter.isAllowed(remoteIp)) {
      logger.warn('Rate limit exceeded for SMTP client', { remoteIp });
      return callback(createSmtpError('Too many requests, try again later', 421));
    }

    callback();
  },
  onMailFrom(address, session, callback) {
    if (!isSenderDomainAllowed(address.address, config.ALLOWED_SENDER_DOMAINS)) {
      const domain = address.address?.split('@')?.[1] || 'invalid';
      logger.warn('Rejected sender domain not in ALLOWED_SENDER_DOMAINS', { sender: address.address, domain });
      return callback(createSmtpError('Sender domain not allowed', 553));
    }

    callback();
  },
  onRcptTo(address, session, callback) {
    const recipient = address.address;
    if (!config.isRecipientDomainAllowed(recipient)) {
      const domain = recipient.split('@')[1] || 'invalid';
      logger.warn('Rejected email to unauthorized domain', { recipient, domain });
      return callback(createSmtpError(`Recipient domain not allowed: ${domain}`, 553));
    }
    callback();
  },
  onData(stream, session, callback) {
    if (webhookQueue.getStats().total >= config.MAX_QUEUE_SIZE) {
      logger.warn('Rejected email because queue is full', { maxQueueSize: config.MAX_QUEUE_SIZE });
      stream.on('error', () => false);
      stream.on('end', () => callback(createSmtpError('Server busy, please retry later', 451)));
      stream.resume();
      return;
    }

    parseEmail(stream)
      .then(async (parsed) => {
        const remoteIp = normalizeIp(session.remoteAddress);
        const fromTrustedRelay = isIpAllowed(remoteIp, config.TRUSTED_RELAY_IPS);

        if (config.REQUIRE_TRUSTED_RELAY && !fromTrustedRelay) {
          throw createSmtpError('SMTP relay is not trusted', 550);
        }

        if (config.REQUIRED_AUTH_RESULTS.length > 0) {
          if (!fromTrustedRelay) {
            throw createSmtpError('Authentication results require a trusted relay', 550);
          }
          if (!hasRequiredAuthResults(parsed, config.REQUIRED_AUTH_RESULTS)) {
            throw createSmtpError('Email failed authentication policy checks', 550);
          }
        }

        const taskId = await durableQueue.create({
          parsed,
          failedWebhooks: null
        });

        webhookQueue.push({ taskId });
        logger.info('Email added to durable queue', { queueSize: webhookQueue.getStats().total, taskId });
        callback();
      })
      .catch(error => {
        logger.error('Parsing or policy error:', { message: error.message, stack: error.stack });
        if (error.responseCode) {
          callback(error);
          return;
        }
        callback(createSmtpError('Failed to parse email', 451));
      });
  },
  disabledCommands: ['AUTH'],
  secure: config.SMTP_SECURE,
  maxClients: config.SMTP_MAX_CLIENTS,
  socketTimeout: config.SMTP_SOCKET_TIMEOUT,
  closeTimeout: config.SMTP_CLOSE_TIMEOUT,
  size: config.SMTP_MAX_MESSAGE_SIZE
};

// Add TLS options if secure mode is enabled
if (config.SMTP_SECURE && config.TLS && !config.TLS.error) {
  smtpOptions.key = config.TLS.key;
  smtpOptions.cert = config.TLS.cert;
}

const server = new SMTPServer(smtpOptions);

server.on('error', (error) => {
  const errorData = serializeError(error);
  if (isRecoverableNetworkError(error)) {
    logger.warn('Recoverable SMTP connection error', errorData);
    return;
  }

  logger.error('SMTP server error:', errorData);
});

async function replayDurableQueue() {
  const taskIds = await durableQueue.listIds();
  if (taskIds.length === 0) {
    return;
  }

  for (const taskId of taskIds) {
    webhookQueue.push({ taskId });
  }
  logger.info('Replayed durable queue tasks on startup', { count: taskIds.length });
}

async function startServer() {
  try {
    await durableQueue.ensureInitialized();
    await replayDurableQueue();
  } catch (error) {
    logger.error('Failed to initialize durable queue:', { message: error.message, stack: error.stack });
    process.exit(1);
    return;
  }

  server.listen(config.PORT, '0.0.0.0', err => {
    if (err) {
      logger.error('Failed to start SMTP server:', { message: err.message, stack: err.stack });
      process.exit(1);
    }
    logger.info(`SMTP server listening on port ${config.PORT} on all interfaces`);
  });
}

startServer().catch((error) => {
  logger.error('Unexpected startup failure:', { message: error.message, stack: error.stack });
  process.exit(1);
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
  const errorData = serializeError(err);

  if (isRecoverableNetworkError(err)) {
    logger.warn('Recoverable uncaught exception ignored', errorData);
    return;
  }

  logger.error('Uncaught exception:', errorData);
  gracefulShutdown('Uncaught exception');
});

process.on('unhandledRejection', (reason, promise) => {
  const reasonData = serializeError(reason);

  if (isRecoverableNetworkError(reason)) {
    logger.warn('Recoverable unhandled rejection ignored', reasonData);
    return;
  }

  logger.error('Unhandled Rejection:', { reason: reasonData, promise: String(promise) });
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

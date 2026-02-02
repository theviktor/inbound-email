const winston = require('winston');
require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Add file transport only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  try {
    logger.add(new winston.transports.DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '90d'
    }));
  } catch (error) {
    logger.warn('Could not initialize file logging:', error.message);
  }
}

module.exports = logger;

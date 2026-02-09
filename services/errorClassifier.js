const RECOVERABLE_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_STREAM_PREMATURE_CLOSE'
]);

const RECOVERABLE_MESSAGE_PATTERNS = [
  /unknown protocol/i,
  /wrong version number/i,
  /tlsv1 alert/i,
  /read ETIMEDOUT/i,
  /socket hang up/i,
  /Client network socket disconnected/i
];

function serializeError(errorLike) {
  if (errorLike instanceof Error) {
    return {
      message: errorLike.message,
      stack: errorLike.stack,
      code: typeof errorLike.code === 'string' ? errorLike.code : undefined
    };
  }

  if (typeof errorLike === 'string') {
    return { message: errorLike };
  }

  if (errorLike && typeof errorLike === 'object') {
    let message = 'Unknown error object';
    if (typeof errorLike.message === 'string' && errorLike.message) {
      message = errorLike.message;
    } else {
      try {
        message = JSON.stringify(errorLike);
      } catch {
        message = String(errorLike);
      }
    }

    return {
      message,
      code: typeof errorLike.code === 'string' ? errorLike.code : undefined
    };
  }

  return { message: String(errorLike) };
}

function isRecoverableNetworkError(errorLike) {
  const normalized = serializeError(errorLike);
  const code = normalized.code;

  if (code && RECOVERABLE_CODES.has(code)) {
    return true;
  }

  const message = normalized.message || '';
  return RECOVERABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

module.exports = {
  isRecoverableNetworkError,
  serializeError
};

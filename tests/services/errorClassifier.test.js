const { isRecoverableNetworkError, serializeError } = require('../../services/errorClassifier');

describe('errorClassifier', () => {
  it('marks known socket error codes as recoverable', () => {
    expect(isRecoverableNetworkError({ code: 'ETIMEDOUT', message: 'read ETIMEDOUT' })).toBe(true);
    expect(isRecoverableNetworkError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(true);
  });

  it('marks TLS protocol mismatch as recoverable', () => {
    const tlsError = new Error(
      'SSL routines:tls_early_post_process_client_hello:unknown protocol'
    );

    expect(isRecoverableNetworkError(tlsError)).toBe(true);
  });

  it('does not mark unrelated errors as recoverable', () => {
    expect(isRecoverableNetworkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('normalizes non-error values into serializable error data', () => {
    expect(serializeError('plain text failure')).toEqual({ message: 'plain text failure' });
    expect(serializeError(null)).toEqual({ message: 'null' });
  });
});

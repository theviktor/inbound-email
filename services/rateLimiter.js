class SlidingWindowRateLimiter {
  constructor({ windowMs, maxHits }) {
    this.windowMs = windowMs;
    this.maxHits = maxHits;
    this.hitsByKey = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const previousHits = this.hitsByKey.get(key) || [];
    const recentHits = previousHits.filter((timestamp) => timestamp > windowStart);
    recentHits.push(now);
    this.hitsByKey.set(key, recentHits);

    return recentHits.length <= this.maxHits;
  }
}

module.exports = { SlidingWindowRateLimiter };

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

class WebhookRouter {
  constructor(config) {
    this.rules = this.parseRules(config.WEBHOOK_RULES);
    this.defaultWebhook = config.WEBHOOK_URL;
  }

  parseRules(rulesConfig) {
    if (!rulesConfig) {
      return [];
    }

    try {
      const rules = typeof rulesConfig === 'string' 
        ? JSON.parse(rulesConfig) 
        : rulesConfig;
      
      // Sort rules by priority (lower number = higher priority)
      if (Array.isArray(rules)) {
        return rules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
      } else if (rules.rules && Array.isArray(rules.rules)) {
        return rules.rules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
      }
      
      return [];
    } catch (error) {
      logger.error('Failed to parse webhook rules:', error);
      return [];
    }
  }

  evaluateCondition(condition, value) {
    if (!condition || !value) return false;

    // Handle wildcard patterns (e.g., "support@*")
    if (condition.includes('*')) {
      const pattern = condition.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`, 'i');
      return regex.test(value);
    }

    // Handle regex patterns (e.g., "/^support@/i")
    if (condition.startsWith('/') && condition.lastIndexOf('/') > 0) {
      const lastSlash = condition.lastIndexOf('/');
      const pattern = condition.substring(1, lastSlash);
      const flags = condition.substring(lastSlash + 1);
      try {
        const regex = new RegExp(pattern, flags);
        return regex.test(value);
      } catch (error) {
        logger.error('Invalid regex pattern:', condition, error);
        return false;
      }
    }

    // Handle array values (check if any match)
    if (Array.isArray(value)) {
      return value.some(v => this.evaluateCondition(condition, v));
    }

    // Exact match (case-insensitive)
    return value.toLowerCase() === condition.toLowerCase();
  }

  evaluateRule(rule, email) {
    if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
      // No conditions means always match (useful for default rule)
      return true;
    }

    // All conditions must match (AND logic)
    for (const [field, condition] of Object.entries(rule.conditions)) {
      let emailValue;

      switch (field) {
        case 'from':
          emailValue = this.extractEmail(email.from);
          break;
        case 'to':
          emailValue = this.extractEmail(email.to);
          break;
        case 'cc':
          emailValue = this.extractEmail(email.cc);
          break;
        case 'subject':
          emailValue = email.subject;
          break;
        case 'hasAttachments':
          emailValue = (email.attachmentInfo && email.attachmentInfo.length > 0).toString();
          break;
        case 'header':
          // Support custom header matching
          if (condition.name && email.headers) {
            emailValue = email.headers.get(condition.name);
            if (!this.evaluateCondition(condition.value, emailValue)) {
              return false;
            }
            continue;
          }
          break;
        default:
          // Support nested fields using dot notation
          emailValue = this.getNestedValue(email, field);
      }

      if (!this.evaluateCondition(condition, emailValue)) {
        return false;
      }
    }

    return true;
  }

  extractEmail(addressField) {
    if (!addressField) return null;
    
    if (typeof addressField === 'string') {
      return addressField;
    }
    
    if (addressField.text) {
      return addressField.text;
    }
    
    if (addressField.value && Array.isArray(addressField.value)) {
      return addressField.value.map(addr => addr.address || addr.text).filter(Boolean);
    }
    
    if (addressField.address) {
      return addressField.address;
    }
    
    return null;
  }

  getNestedValue(obj, path) {
    const keys = path.split('.');
    let value = obj;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  route(email) {
    const matchedWebhooks = [];

    // Evaluate each rule
    for (const rule of this.rules) {
      if (this.evaluateRule(rule, email)) {
        logger.info(`Email matched rule: ${rule.name || 'unnamed'}`);
        
        matchedWebhooks.push({
          webhook: rule.webhook,
          ruleName: rule.name || 'unnamed',
          priority: rule.priority || 999
        });

        // If rule has stopProcessing flag, don't evaluate further rules
        if (rule.stopProcessing) {
          break;
        }
      }
    }

    // If no rules matched, use default webhook
    if (matchedWebhooks.length === 0 && this.defaultWebhook) {
      logger.info('No rules matched, using default webhook');
      matchedWebhooks.push({
        webhook: this.defaultWebhook,
        ruleName: 'default',
        priority: 9999
      });
    }

    return matchedWebhooks;
  }

  getAllWebhooks() {
    const webhooks = new Set();
    
    for (const rule of this.rules) {
      if (rule.webhook) {
        webhooks.add(rule.webhook);
      }
    }
    
    if (this.defaultWebhook) {
      webhooks.add(this.defaultWebhook);
    }
    
    return Array.from(webhooks);
  }
}

module.exports = WebhookRouter;
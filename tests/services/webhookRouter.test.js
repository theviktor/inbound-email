const WebhookRouter = require('../../services/webhookRouter');

describe('WebhookRouter', () => {
  describe('Basic Routing', () => {
    it('should route to default webhook when no rules match', () => {
      const router = new WebhookRouter({
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email'
      };

      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://default.webhook.com');
      expect(result[0].ruleName).toBe('default');
    });

    it('should route based on sender email', () => {
      const rules = {
        rules: [
          {
            name: 'support-emails',
            conditions: { from: 'support@example.com' },
            webhook: 'https://support.webhook.com',
            priority: 1
          }
        ]
      };

      const router = new WebhookRouter({
        WEBHOOK_RULES: JSON.stringify(rules),
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: { text: 'support@example.com' },
        to: 'user@company.com',
        subject: 'Support Request'
      };

      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://support.webhook.com');
      expect(result[0].ruleName).toBe('support-emails');
    });

    it('should handle wildcard patterns', () => {
      const rules = [
        {
          name: 'all-support',
          conditions: { from: '*@support.com' },
          webhook: 'https://support.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'anyone@support.com',
        subject: 'Support Issue'
      };

      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://support.webhook.com');
    });

    it('should handle regex patterns', () => {
      const rules = [
        {
          name: 'urgent-emails',
          conditions: { subject: '/^URGENT:/i' },
          webhook: 'https://urgent.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'test@example.com',
        subject: 'URGENT: Server Down'
      };

      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://urgent.webhook.com');
    });
  });

  describe('Complex Conditions', () => {
    it('should evaluate multiple conditions with AND logic', () => {
      const rules = [
        {
          name: 'specific-combo',
          conditions: { 
            from: 'admin@company.com',
            subject: '*report*'
          },
          webhook: 'https://reports.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      // Should match
      const matchingEmail = {
        from: 'admin@company.com',
        subject: 'Monthly report summary'
      };

      const matchResult = router.route(matchingEmail);
      expect(matchResult).toHaveLength(1);
      expect(matchResult[0].webhook).toBe('https://reports.webhook.com');

      // Should not match (only one condition satisfied)
      const nonMatchingEmail = {
        from: 'user@company.com',
        subject: 'Monthly report summary'
      };

      const noMatchResult = router.route(nonMatchingEmail);
      expect(noMatchResult).toHaveLength(1);
      expect(noMatchResult[0].webhook).toBe('https://default.webhook.com');
    });

    it('should handle attachment conditions', () => {
      const rules = [
        {
          name: 'with-attachments',
          conditions: { hasAttachments: 'true' },
          webhook: 'https://attachments.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const emailWithAttachments = {
        from: 'test@example.com',
        attachmentInfo: [{ filename: 'test.pdf' }]
      };

      const result = router.route(emailWithAttachments);
      expect(result[0].webhook).toBe('https://attachments.webhook.com');

      const emailWithoutAttachments = {
        from: 'test@example.com',
        attachmentInfo: []
      };

      const result2 = router.route(emailWithoutAttachments);
      expect(result2[0].webhook).toBe('https://default.webhook.com');
    });

    it('should handle array email addresses', () => {
      const rules = [
        {
          name: 'team-emails',
          conditions: { to: 'team@company.com' },
          webhook: 'https://team.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'external@client.com',
        to: {
          value: [
            { address: 'user1@company.com' },
            { address: 'team@company.com' },
            { address: 'user2@company.com' }
          ]
        }
      };

      const result = router.route(email);
      expect(result[0].webhook).toBe('https://team.webhook.com');
    });
  });

  describe('Priority and Multiple Rules', () => {
    it('should sort rules by priority', () => {
      const rules = [
        {
          name: 'low-priority',
          conditions: { from: '*@example.com' },
          webhook: 'https://low.webhook.com',
          priority: 100
        },
        {
          name: 'high-priority',
          conditions: { from: 'admin@example.com' },
          webhook: 'https://high.webhook.com',
          priority: 1
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'admin@example.com',
        subject: 'Test'
      };

      const result = router.route(email);
      
      // Both rules match, but high priority should come first
      expect(result).toHaveLength(2);
      expect(result[0].webhook).toBe('https://high.webhook.com');
      expect(result[1].webhook).toBe('https://low.webhook.com');
    });

    it('should stop processing when stopProcessing is true', () => {
      const rules = [
        {
          name: 'stop-here',
          conditions: { subject: '*test*' },
          webhook: 'https://first.webhook.com',
          priority: 1,
          stopProcessing: true
        },
        {
          name: 'should-not-match',
          conditions: { subject: '*test*' },
          webhook: 'https://second.webhook.com',
          priority: 2
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'test@example.com',
        subject: 'test message'
      };

      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://first.webhook.com');
    });
  });

  describe('Utility Functions', () => {
    it('should extract email from various formats', () => {
      const router = new WebhookRouter({ WEBHOOK_URL: 'https://default.com' });

      expect(router.extractEmail('test@example.com')).toBe('test@example.com');
      expect(router.extractEmail({ text: 'test@example.com' })).toBe('test@example.com');
      expect(router.extractEmail({ address: 'test@example.com' })).toBe('test@example.com');
      expect(router.extractEmail({
        value: [
          { address: 'test1@example.com' },
          { address: 'test2@example.com' }
        ]
      })).toEqual(['test1@example.com', 'test2@example.com']);
    });

    it('should get nested values correctly', () => {
      const router = new WebhookRouter({ WEBHOOK_URL: 'https://default.com' });
      
      const obj = {
        level1: {
          level2: {
            value: 'found'
          }
        }
      };

      expect(router.getNestedValue(obj, 'level1.level2.value')).toBe('found');
      expect(router.getNestedValue(obj, 'level1.missing')).toBeUndefined();
    });

    it('should get all configured webhooks', () => {
      const rules = [
        {
          name: 'rule1',
          conditions: { from: 'test1@example.com' },
          webhook: 'https://webhook1.com'
        },
        {
          name: 'rule2',
          conditions: { from: 'test2@example.com' },
          webhook: 'https://webhook2.com'
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const webhooks = router.getAllWebhooks();
      
      expect(webhooks).toContain('https://webhook1.com');
      expect(webhooks).toContain('https://webhook2.com');
      expect(webhooks).toContain('https://default.webhook.com');
      expect(webhooks).toHaveLength(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      const router = new WebhookRouter({
        WEBHOOK_RULES: 'invalid json {',
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = { from: 'test@example.com' };
      const result = router.route(email);
      
      expect(result).toHaveLength(1);
      expect(result[0].webhook).toBe('https://default.webhook.com');
    });

    it('should handle invalid regex patterns', () => {
      const rules = [
        {
          name: 'bad-regex',
          conditions: { subject: '/[invalid/i' }, // Invalid regex
          webhook: 'https://bad.webhook.com'
        }
      ];

      const router = new WebhookRouter({
        WEBHOOK_RULES: rules,
        WEBHOOK_URL: 'https://default.webhook.com'
      });

      const email = {
        from: 'test@example.com',
        subject: '[invalid'
      };

      const result = router.route(email);
      expect(result[0].webhook).toBe('https://default.webhook.com');
    });

    it('should reject http webhooks unless insecure mode is enabled', () => {
      const strictRouter = new WebhookRouter({
        WEBHOOK_URL: 'http://insecure.webhook.com'
      });

      expect(strictRouter.route({ from: 'test@example.com' })).toHaveLength(0);

      const insecureAllowedRouter = new WebhookRouter({
        WEBHOOK_URL: 'http://insecure.webhook.com',
        ALLOW_INSECURE_WEBHOOK_HTTP: true
      });

      expect(insecureAllowedRouter.route({ from: 'test@example.com' })).toHaveLength(1);
    });
  });
});

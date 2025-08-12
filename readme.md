# Inbound Email (SMTP) to Webhook

Author: Martin Krivosija - [LinkedIn](https://linkedin.com/in/martin-alexander-k)

A simple, efficient script that provides an SMTP server to receive emails, parse content (including headers), store attachments in Amazon S3, and forward email content to a webhook. Graceful handling of multiple concurrent SMTP sessions and webhook requests.

## Features

- SMTP server to receive emails concurrently
- Parses incoming emails using `mailparser`
- **Enhanced Error Recovery**: Automatic fallback to local storage when S3 is unavailable, with background retry mechanism
- **Multiple Webhook Support**: Route emails to different webhooks based on sender, recipient, subject, or custom rules
- Uploads attachments to Amazon S3 with intelligent fallback
- Forwards parsed email content to webhook endpoints
- Configurable via environment variables
- Handles large attachments gracefully
- Robust queue system for processing multiple emails and webhook requests simultaneously
- **Comprehensive Test Coverage**: >90% code coverage with Jest testing framework
- Daily rotating logs with 90-day retention

## Prerequisites

- Node.js (v18 or later recommended)
- If saving attachments, an Amazon Web Services (AWS) account with S3 access or a compatible system
- A HTTP(s) webhook endpoint to receive the processed emails

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/kriiv/inbound-email.git
   cd inbound-email
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Copy the `.env.example` file to `.env` and set the required configuration: (eg. `mv .env.example .env`)

   ### Core Configuration

   | Variable              | Description                                                     | Required | Default     |
   | --------------------- | --------------------------------------------------------------- | -------- | ----------- |
   | `WEBHOOK_URL`         | The URL where parsed emails will be sent (if not using rules)   | Yes*     | `null`      |
   | `WEBHOOK_RULES`       | JSON configuration for multiple webhook routing (see below)     | No       | `null`      |
   | `PORT`                | The port for the SMTP server to listen on                       | No       | `25`        |
   | `SMTP_SECURE`         | Set to 'true' for TLS support (requires key/cert setup)         | No       | `false`     |
   | `WEBHOOK_CONCURRENCY` | Number of concurrent webhook requests                           | No       | `5`         |

   ### Attachment Storage

   | Variable              | Description                                                     | Required | Default     |
   | --------------------- | --------------------------------------------------------------- | -------- | ----------- |
   | `MAX_FILE_SIZE`       | Maximum attachment size in bytes (0 to disable S3 uploads)      | No       | `5242880` (5MB) |
   | `AWS_REGION`          | Your AWS region                                                 | If saving| `null`      |
   | `AWS_ACCESS_KEY_ID`   | Your AWS access key ID                                          | If saving| `null`      |
   | `AWS_SECRET_ACCESS_KEY`| Your AWS secret access key                                      | If saving| `null`      |
   | `S3_BUCKET_NAME`      | The name of your S3 bucket for storing attachments              | If saving| `null`      |

   ### Enhanced Error Recovery

   | Variable                | Description                                                     | Required | Default     |
   | ----------------------- | --------------------------------------------------------------- | -------- | ----------- |
   | `LOCAL_STORAGE_PATH`    | Directory for temporary storage when S3 fails                   | No       | `./temp-attachments` |
   | `LOCAL_STORAGE_RETENTION` | Hours to keep local files before cleanup                      | No       | `24`        |
   | `S3_RETRY_INTERVAL`     | Minutes between S3 retry attempts                               | No       | `5`         |

   ### Security (TLS)

   | Variable              | Description                                                     | Required | Default     |
   | --------------------- | --------------------------------------------------------------- | -------- | ----------- |
   | `TLS_KEY_PATH`        | Path to the TLS private key file (if `SMTP_SECURE=true`)        | If secure| `null`      |
   | `TLS_CERT_PATH`       | Path to the TLS certificate file (if `SMTP_SECURE=true`)        | If secure| `null`      |

   *Note: Either `WEBHOOK_URL` or `WEBHOOK_RULES` must be configured. S3 credentials are required if `MAX_FILE_SIZE` > 0.*

## Usage

Start the server:
```
npm start
```

The SMTP server will start and listen on the specified port (default: 25) on all network interfaces.

You can use pm2 or supervisor to keep the server running after restart. Example: `pm2 start server.js`

## Multiple Webhook Configuration

The service supports routing emails to different webhooks based on email content. Configure using the `WEBHOOK_RULES` environment variable:

### Simple Example
```json
{
  "rules": [
    {
      "name": "support-emails",
      "conditions": { "to": "support@*" },
      "webhook": "https://support.webhook.com",
      "priority": 1
    },
    {
      "name": "sales-inquiries", 
      "conditions": { "subject": "*quote*" },
      "webhook": "https://sales.webhook.com",
      "priority": 2
    },
    {
      "name": "default",
      "conditions": {},
      "webhook": "https://default.webhook.com",
      "priority": 999
    }
  ]
}
```

### Advanced Example
```json
{
  "rules": [
    {
      "name": "urgent-admin",
      "conditions": {
        "from": "admin@company.com",
        "subject": "/^URGENT:/i"
      },
      "webhook": "https://urgent.webhook.com",
      "priority": 1,
      "stopProcessing": true
    },
    {
      "name": "with-attachments",
      "conditions": { "hasAttachments": "true" },
      "webhook": "https://attachments.webhook.com",
      "priority": 5
    },
    {
      "name": "team-notifications",
      "conditions": { "to": "team-*@company.com" },
      "webhook": "https://team.webhook.com",
      "priority": 10
    }
  ]
}
```

### Condition Types

- **Exact match**: `"from": "admin@company.com"`
- **Wildcard**: `"to": "support@*"` or `"subject": "*report*"`  
- **Regex**: `"subject": "/^URGENT:/i"`
- **Built-in fields**: 
  - `from`, `to`, `cc`: Email addresses
  - `subject`: Email subject line
  - `hasAttachments`: "true" or "false"
- **Custom headers**: `"header": {"name": "X-Priority", "value": "high"}`

### Rule Processing

1. Rules are sorted by `priority` (lower = higher priority)
2. All matching rules receive the email (unless `stopProcessing: true`)
3. If no rules match, falls back to `WEBHOOK_URL` if configured
4. Each webhook receives the email data plus `_webhookMeta` with rule information

## Enhanced Error Recovery

The service provides automatic resilience for attachment storage:

### Local Storage Fallback
- When S3 is unavailable, attachments are stored locally in `LOCAL_STORAGE_PATH`
- Background retry process attempts S3 upload every `S3_RETRY_INTERVAL` minutes
- Files older than `LOCAL_STORAGE_RETENTION` hours are automatically cleaned up
- Webhooks receive storage location and type information

### Email Response Structure
```json
{
  "from": "sender@example.com",
  "subject": "Email with attachments",
  "attachmentInfo": [
    {
      "filename": "document.pdf",
      "size": 1024,
      "location": "https://s3.amazonaws.com/bucket/document.pdf",
      "storageType": "s3"
    },
    {
      "filename": "backup.zip", 
      "size": 2048,
      "location": "/temp-attachments/123456-backup.zip",
      "storageType": "local",
      "note": "Temporarily stored locally, will be uploaded to S3 when available"
    }
  ],
  "storageSummary": {
    "total": 2,
    "uploadedToS3": 1,
    "storedLocally": 1,
    "skipped": 0
  }
}
```

## Testing

Run the comprehensive test suite:

```bash
# Install dev dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode (during development)
npm run test:watch
```

The test suite provides >90% code coverage across all services.

## Sample Use Cases

1. **Email to Ticket System**: Use this bridge to receive support emails and automatically create tickets in your helpdesk system via the webhook.

2. **Document Processing**: Receive emails with document attachments, store them in S3, and trigger a document processing pipeline through the webhook.

3. **Email Marketing Analysis**: Collect incoming emails from a campaign, store any images or attachments, and send the content to an analytics system for processing.

4. **Automated Reporting**: Set up an email address that receives automated reports, stores them in S3, and notifies your team via the webhook.

5. **DMARC Reporting**: Receive DMARC reports via email and store them in S3.

Using inbound parse for something interesting? Please let me know, I'd love to hear about it.

## Todo

- Rate limiting
- ~~Log Storage~~ (completed)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or get in touch.  

## License

This project is licensed under the MIT License. This means you are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, including for commercial purposes.

## Disclaimer

Please ensure you have the necessary permissions and security measures in place when deploying an SMTP server. Depending on your firewall configuration, you may be exposing this service to the internet.

## Security Considerations

When deploying this SMTP server, please keep the following security considerations in mind:

- Ensure that your server is properly secured and that only authorized IPs can access the SMTP port.
- Use strong, unique passwords for your AWS credentials and keep them secure.
- Regularly update the Node.js runtime and all dependencies to their latest versions.
- Consider implementing additional authentication mechanisms for the SMTP server if needed.

## Logging and Monitoring

The server logs information about received emails, webhook responses, and any errors that occur. The current logging setup includes:

- Console output for immediate visibility
- Daily rotating log files for persistent storage
- JSON formatting of log entries for easy parsing
- Timestamp inclusion for each log entry
 
Logging settings:

- Log files are stored in the `logs/` directory
- Files are named `application-YYYY-MM-DD.log`
- Log files are rotated daily and compressed
- Maximum log file size is set to 20MB
- Log files are kept for 90 days

I recommend:   

- Review log files regularly for errors or unusual patterns.
- Consider setting up log aggregation and analysis tools (e.g., ELK stack, Splunk).
- Implement alerts for critical errors or unusual activity patterns.
- Monitor system resources (CPU, memory, disk space) to ensure smooth operation.
- Set up uptime monitoring for the SMTP server and webhook endpoint.

## System Requirements

- Node.js v18 or later
- Sufficient disk space for temporary storage of attachments before S3 upload and 90 days of logging.
- Outbound internet access for S3 uploads and webhook calls
- Inbound access on the configured SMTP port. (Default: 25, or 587 if `SMTP_SECURE` is set to 'true')

## Troubleshooting

If you encounter issues:

1. Check the server logs for any error messages.
2. Ensure all environment variables are correctly set.
3. Verify that your AWS credentials have the necessary permissions for S3 operations.
4. Check that the webhook endpoint is accessible and responding correctly.
5. For attachment issues, verify that the `MAX_FILE_SIZE` setting is appropriate for your use case.

If problems persist, please open an issue on the GitHub repository with detailed information about the error and your setup.
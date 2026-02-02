const simpleParser = require('mailparser').simpleParser;
const { uploadToS3 } = require('./s3Service');
const logger = require('./logger');

async function parseEmail(stream) {
  const parsed = await simpleParser(stream);
  const attachments = parsed.attachments || [];
  delete parsed.attachments;

  // Use Promise.allSettled to handle individual attachment failures gracefully
  const results = await Promise.allSettled(attachments.map(async att => {
    const uploadResult = await uploadToS3(att);
    
    return {
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      location: uploadResult.location,
      storageType: uploadResult.storageType,
      metadata: uploadResult.metadata || null,
      skipped: uploadResult.storageType === 'skipped'
    };
  }));

  // Process results, handling both fulfilled and rejected promises
  const processedAttachments = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // Log the error but don't fail the entire email
      const att = attachments[index];
      logger.error('Failed to process attachment:', {
        filename: att.filename,
        error: result.reason?.message || 'Unknown error'
      });
      return {
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        location: null,
        storageType: 'failed',
        error: result.reason?.message || 'Unknown error',
        skipped: false
      };
    }
  });

  // Separate attachments by storage type
  parsed.attachmentInfo = processedAttachments.filter(att => !att.skipped).map(att => ({
    filename: att.filename,
    contentType: att.contentType,
    size: att.size,
    location: att.location,
    storageType: att.storageType,
    ...(att.storageType === 'local' && { 
      note: 'Temporarily stored locally, will be uploaded to S3 when available',
      metadata: att.metadata 
    })
  }));
  
  parsed.skippedAttachments = processedAttachments.filter(att => att.skipped).map(att => ({
    filename: att.filename,
    size: att.size,
    reason: 'File size exceeds maximum allowed'
  }));

  // Add storage summary
  const s3Count = processedAttachments.filter(att => att.storageType === 's3').length;
  const localCount = processedAttachments.filter(att => att.storageType === 'local').length;
  const skippedCount = processedAttachments.filter(att => att.skipped).length;
  
  if (attachments.length > 0) {
    parsed.storageSummary = {
      total: attachments.length,
      uploadedToS3: s3Count,
      storedLocally: localCount,
      skipped: skippedCount
    };
  }

  return parsed;
}

module.exports = { parseEmail };
#!/usr/bin/env node
/**
 * S3 Connection Test Script
 * Run with: node test-s3.js
 */

require('dotenv').config();
const { S3Client, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

async function testS3Connection() {
  console.log('\n=== S3 Connection Test ===\n');
  
  // Check required environment variables
  const config = {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET_NAME,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  };
  
  console.log('1. Checking environment variables...');
  console.log('   AWS_REGION:', config.region || '❌ NOT SET');
  console.log('   AWS_ACCESS_KEY_ID:', config.accessKeyId ? '✅ Set' : '❌ NOT SET');
  console.log('   AWS_SECRET_ACCESS_KEY:', config.secretAccessKey ? '✅ Set' : '❌ NOT SET');
  console.log('   S3_BUCKET_NAME:', config.bucket || '❌ NOT SET');
  console.log('   S3_ENDPOINT:', config.endpoint || '(using default AWS)');
  console.log('   S3_FORCE_PATH_STYLE:', config.forcePathStyle);
  
  if (!config.region || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    console.log('\n❌ Missing required S3 configuration. Check your .env file.\n');
    process.exit(1);
  }
  
  // Create S3 client
  console.log('\n2. Creating S3 client...');
  const s3Config = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  };
  
  if (config.endpoint) {
    s3Config.endpoint = config.endpoint;
  }
  
  if (config.forcePathStyle) {
    s3Config.forcePathStyle = true;
  }
  
  const s3 = new S3Client(s3Config);
  console.log('   ✅ S3 client created');
  
  // Test upload (skip HeadBucket as some S3 providers restrict it)
  console.log('\n3. Testing file upload...');
  const testKey = `test-upload-${Date.now()}.txt`;
  const testContent = `S3 connection test - ${new Date().toISOString()}`;
  
  try {
    await s3.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain'
    }));
    console.log(`   ✅ Upload successful: ${testKey}`);
  } catch (error) {
    console.log(`   ❌ Upload failed: ${error.message}`);
    process.exit(1);
  }
  
  // Cleanup test file
  console.log('\n4. Cleaning up test file...');
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: testKey
    }));
    console.log('   ✅ Test file deleted');
  } catch (error) {
    console.log(`   ⚠️ Cleanup failed (non-critical): ${error.message}`);
  }
  
  console.log('\n=== S3 Connection Test PASSED ===\n');
  console.log('Your S3 configuration is working correctly.');
  console.log('Make sure to restart the SMTP server to apply the configuration.\n');
  
  process.exit(0);
}

testS3Connection().catch(error => {
  console.error('\n❌ Unexpected error:', error.message);
  process.exit(1);
});

const redis = require('../config/db');

async function testLink() {
  try {
    // Test data
    const testData = {
      longURL: 'https://example.com/test',
      userType: 'customer',
      bookingStartTime: new Date(),
      deepLink: 'rydeu://app/test',
      iosLink: 'rydeu://app/test'
    };

    // Create a test link
    const linkModel = require('../models/linkModel');
    const newLink = await linkModel.create(testData);
    console.log('Created new link:', newLink);

    // Check Redis data
    const shortIdKey = `shortId:${newLink.shortId}`;
    const linkKey = `link:${testData.longURL}`;

    console.log('\nChecking Redis data:');
    console.log('ShortId key:', shortIdKey);
    console.log('Link key:', linkKey);

    const shortIdData = await redis.get(shortIdKey);
    const linkData = await redis.get(linkKey);

    console.log('\nShortId data:', JSON.parse(shortIdData));
    console.log('\nLink data:', JSON.parse(linkData));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit();
  }
}

testLink(); 
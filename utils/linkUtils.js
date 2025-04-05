function calculateExpirationTime(link) {
  let expirationTime;
  if (link.bookingStartTime) {
    // If bookingStartTime exists, expire after 1 day
    expirationTime = new Date(link.bookingStartTime);
    expirationTime.setDate(expirationTime.getDate() + 1);
  } else {
    // If no bookingStartTime, expire after 9 months from creation
    expirationTime = new Date(link.createdAt || link.bookingStartTime);
    expirationTime.setMonth(expirationTime.getMonth() + 9);
  }
  return expirationTime;
}

function getSecondsUntilExpiration(expirationTime) {
  return Math.max(3600, Math.floor((expirationTime - new Date()) / 1000));
}

module.exports = {
  calculateExpirationTime,
  getSecondsUntilExpiration
}; 
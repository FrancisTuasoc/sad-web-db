const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { MONGODB_URI } = require('../config/env');
const { cleanupOrphanedAvatars, getAvatarStorageUsage } = require('../services/avatarStorage');

async function main() {
  await connectDB(MONGODB_URI);
  const cleanup = await cleanupOrphanedAvatars();
  const usage = await getAvatarStorageUsage();
  console.log(`Deleted orphaned avatars: ${cleanup.deletedCount}`);
  console.log(`Storage freed: ${cleanup.freedMiB} MiB`);
  console.log(`Avatar payload usage: ${usage.usedMiB} MiB across ${usage.avatarCount} avatars`);
}

main()
  .catch((error) => {
    console.error('Avatar cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  });

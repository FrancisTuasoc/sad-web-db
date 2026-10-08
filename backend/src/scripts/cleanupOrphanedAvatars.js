const { connectDB, closeDB } = require('../config/db');
const {
  cleanupOrphanedAvatars,
  getAvatarStorageUsage,
} = require('../services/avatarStorage');

async function main() {
  await connectDB();
  const cleanup = await cleanupOrphanedAvatars();
  const usage = await getAvatarStorageUsage();
  console.log(`Deleted orphaned avatars: ${cleanup.deletedCount}`);
  console.log(`Storage freed: ${cleanup.freedMiB} MiB`);
  console.log(
    `Avatar payload usage: ${usage.usedMiB} MiB across ${usage.avatarCount} avatars`
  );
}

main()
  .catch((error) => {
    console.error('Avatar cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDB();
  });

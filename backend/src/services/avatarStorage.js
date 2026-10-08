const avatarRepository = require('../repositories/avatarRepository');
const AppError = require('../utils/AppError');

async function reserveAvatarBytes(bytes) {
  const usage = await avatarRepository.getStorageUsage();
  if (usage.usedBytes + bytes > avatarRepository.AVATAR_STORAGE_CAP_BYTES) {
    throw new AppError(
      'Avatar storage is full. Please contact the administrator before uploading another photo.',
      507
    );
  }
}

async function releaseAvatarBytes(bytes) {
  // Not needed for dedicated table, rows are freed upon deletion
}

async function deleteAvatarByUrl(avatarUrl) {
  await avatarRepository.deleteAvatarByUrl(avatarUrl);
}

async function deleteAvatarForUser(user) {
  if (!user || !user.avatarUrl) return;
  await deleteAvatarByUrl(user.avatarUrl);
}

module.exports = {
  AVATAR_BUCKET_NAME: 'customerAvatars',
  AVATAR_MAX_BYTES: avatarRepository.AVATAR_MAX_BYTES,
  AVATAR_REQUEST_LIMIT: avatarRepository.AVATAR_REQUEST_LIMIT,
  AVATAR_STORAGE_CAP_BYTES: avatarRepository.AVATAR_STORAGE_CAP_BYTES,
  acquireAvatarUserLock: (userId) => avatarRepository.acquireLock(userId),
  releaseAvatarUserLock: (userId, token) =>
    avatarRepository.releaseLock(userId, token),
  saveAvatar: (userId, data) => avatarRepository.saveAvatar(userId, data),
  getAvatar: (id, userId) => avatarRepository.getAvatar(id, userId),
  deleteAvatarByUrl,
  deleteAvatarForUser,
  getAvatarStorageUsage: () => avatarRepository.getStorageUsage(),
  cleanupOrphanedAvatars: () => avatarRepository.cleanupOrphanedAvatars(),
  reserveAvatarBytes,
  releaseAvatarBytes,
};

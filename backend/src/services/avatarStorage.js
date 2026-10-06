const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const AppError = require('../utils/AppError');

const AVATAR_BUCKET_NAME = 'customerAvatars';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_REQUEST_LIMIT = 6 * 1024 * 1024;
const AVATAR_STORAGE_CAP_BYTES = 400 * 1024 * 1024;
const QUOTA_COLLECTION_NAME = 'customerAvatarStorage';
const QUOTA_DOCUMENT_ID = 'avatar-payload';

function getDatabase() {
  const db = mongoose.connection.db;
  if (!db) throw new AppError('Photo storage is temporarily unavailable. Please try again.', 503);
  return db;
}

function getBucket(db = getDatabase()) {
  return new mongoose.mongo.GridFSBucket(db, { bucketName: AVATAR_BUCKET_NAME });
}

async function ensureQuotaRecord(db) {
  const quota = db.collection(QUOTA_COLLECTION_NAME);
  try {
    const existing = await quota.findOne({ _id: QUOTA_DOCUMENT_ID });
    if (existing) return quota;

    const files = db.collection(`${AVATAR_BUCKET_NAME}.files`);
    const [usage = { usedBytes: 0 }] = await files.aggregate([
      { $group: { _id: null, usedBytes: { $sum: '$length' } } },
    ]).toArray();

    try {
      await quota.insertOne({ _id: QUOTA_DOCUMENT_ID, usedBytes: usage.usedBytes || 0 });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return quota;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Could not check avatar storage availability. Please try again.', 503);
  }
}

async function reserveAvatarBytes(bytes) {
  const db = getDatabase();
  const quota = await ensureQuotaRecord(db);
  const result = await quota.updateOne(
    {
      _id: QUOTA_DOCUMENT_ID,
      usedBytes: { $lte: AVATAR_STORAGE_CAP_BYTES - bytes },
    },
    { $inc: { usedBytes: bytes } }
  );

  if (result.matchedCount !== 1) {
    throw new AppError('Avatar storage is full. Please contact the administrator before uploading another photo.', 507);
  }
}

async function acquireAvatarUserLock(userId) {
  const locks = getDatabase().collection('customerAvatarLocks');
  const now = new Date();
  const lockUntil = new Date(now.getTime() + 10 * 60 * 1000);
  const lockToken = randomUUID();

  try {
    const result = await locks.findOneAndUpdate(
      { _id: userId.toString(), lockUntil: { $lte: now } },
      { $set: { lockUntil, lockToken } },
      { upsert: true, returnDocument: 'after' }
    );
    if (!result) {
      throw new AppError('A photo upload is already in progress for your account. Please try again shortly.', 409);
    }
    return lockToken;
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError('A photo upload is already in progress for your account. Please try again shortly.', 409);
    }
    throw error;
  }
}

async function releaseAvatarUserLock(userId, lockToken) {
  await getDatabase().collection('customerAvatarLocks').deleteOne({
    _id: userId.toString(),
    lockToken,
  });
}

async function releaseAvatarBytes(bytes) {
  if (!bytes) return;
  const db = getDatabase();
  const quota = await ensureQuotaRecord(db);
  await quota.updateOne(
    { _id: QUOTA_DOCUMENT_ID },
    [{ $set: { usedBytes: { $max: [0, { $subtract: ['$usedBytes', bytes] }] } } }]
  );
}

async function deleteAvatarByUrl(avatarUrl) {
  if (!avatarUrl || !avatarUrl.startsWith('gridfs:')) return;
  const db = getDatabase();
  const fileId = avatarUrl.slice('gridfs:'.length);
  if (!mongoose.isValidObjectId(fileId)) return;

  const bucket = getBucket(db);
  const id = new mongoose.Types.ObjectId(fileId);
  const [file] = await bucket.find({ _id: id }).limit(1).toArray();
  if (!file) return;

  await bucket.delete(id);
  await releaseAvatarBytes(file.length || 0);
}

async function deleteAvatarForUser(user) {
  if (!user || !user.avatarUrl || !user.avatarUrl.startsWith('gridfs:')) return;
  await deleteAvatarByUrl(user.avatarUrl);
}

async function getAvatarStorageUsage() {
  const db = getDatabase();
  const files = db.collection(`${AVATAR_BUCKET_NAME}.files`);
  const [usage = { count: 0, usedBytes: 0 }] = await files.aggregate([
    { $group: { _id: null, count: { $sum: 1 }, usedBytes: { $sum: '$length' } } },
  ]).toArray();

  return {
    avatarCount: usage.count || 0,
    usedBytes: usage.usedBytes || 0,
    usedMiB: Number(((usage.usedBytes || 0) / (1024 * 1024)).toFixed(2)),
  };
}

async function cleanupOrphanedAvatars() {
  const db = getDatabase();
  const User = require('../models/User');
  const users = await User.find({ avatarUrl: /^gridfs:/ }).select('avatarUrl').lean();
  const referencedIds = new Set(
    users
      .map((user) => user.avatarUrl.slice('gridfs:'.length))
      .filter((id) => mongoose.isValidObjectId(id))
  );
  const bucket = getBucket(db);
  const files = await bucket.find({}).toArray();
  let deletedCount = 0;
  let freedBytes = 0;

  for (const file of files) {
    if (referencedIds.has(file._id.toString())) continue;
    await bucket.delete(file._id);
    await releaseAvatarBytes(file.length || 0);
    deletedCount += 1;
    freedBytes += file.length || 0;
  }

  return {
    deletedCount,
    freedBytes,
    freedMiB: Number((freedBytes / (1024 * 1024)).toFixed(2)),
  };
}

module.exports = {
  AVATAR_BUCKET_NAME,
  AVATAR_MAX_BYTES,
  AVATAR_REQUEST_LIMIT,
  AVATAR_STORAGE_CAP_BYTES,
  acquireAvatarUserLock,
  cleanupOrphanedAvatars,
  deleteAvatarByUrl,
  deleteAvatarForUser,
  getAvatarStorageUsage,
  releaseAvatarUserLock,
  releaseAvatarBytes,
  reserveAvatarBytes,
};

const cloudinary = require('cloudinary').v2;
const env = require('../config/env');
const AppError = require('../utils/AppError');

function isConfigured() {
  if (env.CLOUDINARY_URL) return true;
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET
  );
}

function initCloudinary() {
  if (env.CLOUDINARY_URL) {
    cloudinary.config({
      cloudinary_url: env.CLOUDINARY_URL,
      secure: true,
    });
  } else if (
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
}

initCloudinary();

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      'Image storage service is not configured. Please set Cloudinary credentials in .env.',
      503
    );
  }
}

function extractPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/image\/upload\/(?:v\d+\/)?([^.#?]+)/);
  return match ? match[1] : null;
}

function uploadBuffer(buffer, options = {}) {
  assertConfigured();

  return new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: 'image',
      folder: options.folder || 'casestudy',
      ...options,
    };

    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          return reject(
            new AppError(
              `Cloudinary upload failed: ${error.message || 'Unknown error'}`,
              502
            )
          );
        }
        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          raw: result,
        });
      }
    );

    stream.end(buffer);
  });
}

async function deleteImage(publicId) {
  if (!publicId || !isConfigured()) return null;
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.warn(`Failed to delete Cloudinary asset "${publicId}":`, err.message);
    return null;
  }
}

module.exports = {
  cloudinary,
  isConfigured,
  assertConfigured,
  uploadBuffer,
  deleteImage,
  extractPublicId,
};

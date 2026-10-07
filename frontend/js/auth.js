// Authentication and User State Management

const AVATAR_PALETTE = [
  '#A4262C', '#D97706', '#2563EB', '#059669',
  '#7C3AED', '#DB2777', '#4B5563', '#EA580C',
];

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function removeToken() {
  localStorage.removeItem('token');
}

export function getUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

export function removeUser() {
  localStorage.removeItem('user');
}

export function isLoggedIn() {
  return Boolean(getToken() && getUser());
}

export function isAdmin() {
  const user = getUser();
  return Boolean(user && user.role === 'admin');
}

export function logout() {
  removeToken();
  removeUser();
  window.location.href = 'index.html';
}

export function getAvatarColor(username = '') {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

export function renderAvatar(user, size = 32) {
  if (!user) {
    return `<div class="avatar-circle" style="width:${size}px;height:${size}px;background:#6B5B52;">?</div>`;
  }

  const avatarUrl = user.avatarUrl && String(user.avatarUrl).trim();
  if (avatarUrl && !avatarUrl.startsWith('gridfs:')) {
    const safeUrl = avatarUrl.replace(/'/g, '%27');
    return `<div class="avatar-circle" style="width:${size}px;height:${size}px;background-image:url('${safeUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;"></div>`;
  }

  const initial = (user.username || user.email || 'U').charAt(0).toUpperCase();
  const bg = getAvatarColor(user.username || 'User');
  return `<div class="avatar-circle" style="width:${size}px;height:${size}px;background-color:${bg};">${initial}</div>`;
}

export function requireAuth(targetRole = null) {
  if (!isLoggedIn()) {
    window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return false;
  }

  if (targetRole === 'admin' && !isAdmin()) {
    window.location.href = 'index.html';
    return false;
  }

  return true;
}

export async function prepareAvatarFile(file) {
  const maxSize = 20 * 1024 * 1024;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowedTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  const mimeType = allowedTypes[extension];

  if (!mimeType || (file.type && file.type !== mimeType)) {
    throw new Error('Choose a JPG, PNG, or WebP photo.');
  }
  if (file.size > maxSize) {
    throw new Error('Photo must be 20MB or smaller.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new Error('The selected photo could not be opened. Try another JPG, PNG, or WebP image.');
  }

  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= 4096) {
      return file.type === mimeType
        ? file
        : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
    }

    const scale = 4096 / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const quality = file.size > 8 * 1024 * 1024 ? 0.92 : 1;
    const resizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The selected photo could not be prepared. Please try again.'));
      }, mimeType, quality);
    });
    if (resizedBlob.size > maxSize) {
      throw new Error('Photo must be 20MB or smaller after resizing.');
    }
    return new File([resizedBlob], file.name, { type: mimeType, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

export async function resizeImageToDataUrl(file, maxDimension = 600, quality = 0.8) {
  if (!file || !Number.isFinite(maxDimension) || maxDimension < 1 || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new Error('Choose a valid image and image size.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new Error('The selected image could not be opened. Choose another image file.');
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  } finally {
    bitmap.close();
  }
}

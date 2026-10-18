// Authentication and User State Management

const AVATAR_PALETTE = [
  '#A4262C',
  '#D97706',
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#DB2777',
  '#4B5563',
  '#EA580C',
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

function getAvatarCacheKey(user) {
  const userId = user && (user.id || user._id);
  return userId ? `gigabite:avatar:${userId}` : null;
}

export function saveAvatarCache(user, dataUrl) {
  const key = getAvatarCacheKey(user);
  if (!key) throw new Error('Could not identify the account for this avatar.');
  localStorage.setItem(key, dataUrl);
}

export function clearAvatarCache(user) {
  const key = getAvatarCacheKey(user);
  if (key) localStorage.removeItem(key);
}

export function removeUser() {
  localStorage.removeItem('user');
}

export function isLoggedIn() {
  return Boolean(getToken() && getUser());
}

export function isAdmin() {
  const user = getUser();
  return Boolean(getToken() && user && user.role === 'admin');
}

export function enforceAdminPortalOnly() {
  if (isAdmin()) {
    const path = (window.location.pathname || '').toLowerCase();
    if (!path.endsWith('admin.html')) {
      window.location.replace('admin.html');
      return true;
    }
  }
  return false;
}

export function logout() {
  removeToken();
  removeUser();
  window.location.href = 'index.html';
}

export function promptLogout() {
  let modal = document.getElementById('logout-confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'logout-confirm-modal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'logout-dialog-title');
    modal.innerHTML = `
      <div class="modal-card logout-modal-card" style="max-width: 380px; width: 90%; text-align: center; padding: 28px 24px; border-radius: 14px; box-shadow: 0 16px 36px rgba(0,0,0,0.25);">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; font-size: 1.35rem; margin: 0 auto 16px;">
          <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
        </div>
        <h3 id="logout-dialog-title" style="margin: 0 0 8px 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main, #111827);">Log Out</h3>
        <p style="margin: 0 0 24px 0; color: var(--color-text-muted, #4b5563); font-size: 0.95rem; line-height: 1.45;">
          Are you sure you want to log out?
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 8px;">
          <button type="button" id="logout-cancel-btn" class="btn logout-modal-btn logout-modal-no" style="flex: 1; min-height: 44px; font-weight: 700;">No</button>
          <button type="button" id="logout-confirm-btn" class="btn logout-modal-btn logout-modal-yes" style="flex: 1; min-height: 44px; font-weight: 700;">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cancelBtn = modal.querySelector('#logout-cancel-btn');
    const confirmBtn = modal.querySelector('#logout-confirm-btn');

    const closeModal = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        closeModal();
      }
    });

    confirmBtn.addEventListener('click', () => {
      logout();
    });
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const cancelBtn = modal.querySelector('#logout-cancel-btn');
  if (cancelBtn) cancelBtn.focus();
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

  let avatarUrl = '';
  const avatarCacheKey = getAvatarCacheKey(user);
  if (avatarCacheKey) {
    try {
      avatarUrl = localStorage.getItem(avatarCacheKey) || '';
    } catch {
      avatarUrl = '';
    }
  }
  avatarUrl =
    avatarUrl || (user.avatarUrl && String(user.avatarUrl).trim()) || '';
  if (
    avatarUrl &&
    !avatarUrl.startsWith('gridfs:') &&
    !avatarUrl.startsWith('pgavatar:')
  ) {
    const safeUrl = avatarUrl
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="avatar-circle" style="width:${size}px;height:${size}px;"><img src="${safeUrl}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;" /></div>`;
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

  if (isAdmin()) {
    const path = (window.location.pathname || '').toLowerCase();
    if (!path.endsWith('admin.html')) {
      window.location.replace('admin.html');
      return false;
    }
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
    throw new Error(
      'The selected photo could not be opened. Try another JPG, PNG, or WebP image.'
    );
  }

  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= 4096) {
      return file.type === mimeType
        ? file
        : new File([file], file.name, {
            type: mimeType,
            lastModified: file.lastModified,
          });
    }

    const scale = 4096 / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Photo processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const quality = file.size > 8 * 1024 * 1024 ? 0.92 : 1;
    const resizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else
            reject(
              new Error(
                'The selected photo could not be prepared. Please try again.'
              )
            );
        },
        mimeType,
        quality
      );
    });
    if (resizedBlob.size > maxSize) {
      throw new Error('Photo must be 20MB or smaller after resizing.');
    }
    return new File([resizedBlob], file.name, {
      type: mimeType,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

export async function resizeImageToDataUrl(
  file,
  maxDimension = 600,
  quality = 0.8
) {
  if (
    !file ||
    !Number.isFinite(maxDimension) ||
    maxDimension < 1 ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 1
  ) {
    throw new Error('Choose a valid image and image size.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new Error(
      'The selected image could not be opened. Choose another image file.'
    );
  }

  try {
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  } finally {
    bitmap.close();
  }
}

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

  if (user.avatarUrl && user.avatarUrl.trim().length > 0) {
    return `<div class="avatar-circle" style="width:${size}px;height:${size}px;background-image:url('${user.avatarUrl}');background-size:cover;background-position:center;"></div>`;
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

export function resizeImageToDataUrl(file, maxDimension = 256, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Please select an image file.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load selected image.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

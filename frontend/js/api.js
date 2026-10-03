// Central API Fetch Wrapper

const API_BASE_URL = 'https://sad-web-db.onrender.com';

export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}/api${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err) {
    throw new Error("Can't reach the server. Check your connection.");
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('Received invalid server response.');
  }

  if (!response.ok) {
    // Session expired or unauthorized
    if (response.status === 401) {
      const isAuthPage = window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html');
      if (!isAuthPage && token) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html?expired=1';
        return;
      }
    }
    const message = data.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

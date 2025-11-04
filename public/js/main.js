// --- Globale Konfiguration & Auth ---
const token = localStorage.getItem('jwtToken');
if (!token && window.location.pathname !== '/login') {
    window.location.href = '/login';
}

const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
};

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('jwtToken');
            window.location.href = '/login';
        });
    }
});

// --- Helper: API Fetch ---
async function apiFetch(url, options = {}) {
    const response = await fetch(url, { headers: authHeaders, ...options });
    if (response.status === 401 || response.status === 403) {
         window.location.href = '/login';
    }
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `API Fehler: ${response.statusText}`);
    }
    return response.json();
}
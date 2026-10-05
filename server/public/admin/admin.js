document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const adminScreen = document.getElementById('admin-screen');
  const loginForm = document.getElementById('login-form');
  const adminUser = document.getElementById('admin-user');
  const adminPass = document.getElementById('admin-pass');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  const navItems = document.querySelectorAll('.nav-item');
  const adminTabs = document.querySelectorAll('.admin-tab');

  const reloadWgBtn = document.getElementById('reload-wg-btn');
  const newClientBtn = document.getElementById('new-client-btn');

  let token = localStorage.getItem('phoenix_admin_token');

  function showScreen(isLoggedIn) {
    if (isLoggedIn) {
      loginScreen.classList.remove('active');
      adminScreen.classList.add('active');
      loadDashboardData();
    } else {
      adminScreen.classList.remove('active');
      loginScreen.classList.add('active');
    }
  }

  // Check initial token
  if (token) {
    showScreen(true);
  } else {
    showScreen(false);
  }

  // Login Form Submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUser.value.trim(),
          password: adminPass.value.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Échec de connexion');
      }

      token = data.token;
      localStorage.setItem('phoenix_admin_token', token);
      showScreen(true);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    }
  });

  // Logout
  logoutBtn.addEventListener('click', () => {
    token = null;
    localStorage.removeItem('phoenix_admin_token');
    showScreen(false);
  });

  // Tab Navigation
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      navItems.forEach(i => i.classList.remove('active'));
      adminTabs.forEach(t => t.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(targetTab).classList.add('active');

      if (targetTab === 'tab-clients') loadClientsData();
    });
  });

  // Fetch with Auth Header
  async function apiFetch(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    };

    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
      token = null;
      localStorage.removeItem('phoenix_admin_token');
      showScreen(false);
      throw new Error('Session expirée');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erreur API');
    }
    return data;
  }

  // Format Bytes
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1000) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }

  // Load Dashboard Data
  async function loadDashboardData() {
    try {
      // 1. Fetch VPN Status
      const statusData = await apiFetch('/api/vpn/status');
      document.getElementById('metric-active-peers').textContent = statusData.activePeers;
      document.getElementById('metric-total-clients').textContent = `Sur ${statusData.totalClients} enregistrés`;
      document.getElementById('metric-rx').textContent = formatBytes(statusData.totalRxBytes);
      document.getElementById('metric-tx').textContent = formatBytes(statusData.totalTxBytes);

      // 2. Fetch Server Info
      const serverData = await apiFetch('/api/vpn/server');
      document.getElementById('server-pubkey').textContent = serverData.publicKey;
      document.getElementById('server-endpoint').textContent = serverData.endpoint;
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  }

  // Load Clients List
  async function loadClientsData() {
    const tbody = document.getElementById('clients-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Chargement des clients...</td></tr>';

    try {
      const data = await apiFetch('/api/clients');
      const clients = data.clients || [];

      if (clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Aucun appareil configuré pour le moment.</td></tr>';
        return;
      }

      tbody.innerHTML = clients.map(c => `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td><code>${c.address}</code></td>
          <td><code>${c.publicKey.substring(0, 16)}...</code></td>
          <td>${c.lastHandshake ? c.lastHandshake : 'Aucun'}</td>
          <td>↓ ${formatBytes(c.bytesReceived)} / ↑ ${formatBytes(c.bytesSent)}</td>
          <td>
            <button class="btn-danger delete-client-btn" data-id="${c.id}" data-name="${c.name}">Supprimer</button>
          </td>
        </tr>
      `).join('');

      // Add event listeners to delete buttons
      document.querySelectorAll('.delete-client-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');
          if (confirm(`Voulez-vous vraiment supprimer l'appareil "${name}" ?`)) {
            try {
              await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
              loadClientsData();
              loadDashboardData();
            } catch (e) {
              alert(`Erreur: ${e.message}`);
            }
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell" style="color:var(--danger);">${err.message}</td></tr>`;
    }
  }

  // Reload WireGuard
  reloadWgBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/api/vpn/reload', { method: 'POST' });
      alert('Interface WireGuard rechargée avec succès !');
      loadDashboardData();
    } catch (err) {
      alert(`Erreur lors du rechargement: ${err.message}`);
    }
  });

  // New Client Creation Modal/Prompt
  newClientBtn.addEventListener('click', async () => {
    const name = prompt('Nom de l\'appareil (ex: PC-Bureau):');
    if (!name) return;
    const publicKey = prompt('Clé publique WireGuard du client (44 caractères Base64):');
    if (!publicKey) return;

    try {
      await apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name, publicKey }),
      });
      alert('Client créé avec succès !');
      loadClientsData();
      loadDashboardData();
    } catch (err) {
      alert(`Erreur: ${err.message}`);
    }
  });

  // Auto Refresh stats every 5 seconds when logged in
  setInterval(() => {
    if (token && adminScreen.classList.contains('active')) {
      loadDashboardData();
    }
  }, 5000);
});

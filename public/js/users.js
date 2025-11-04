// public/js/users.js

// Hilfsfunktion (sollte global in main.js sein, aber sicher ist sicher)
if (typeof escapeHtml === "undefined") {
  window.escapeHtml = function (s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (match) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[match]));
  };
}

let userModalInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  loadUsers();

  userModalInstance = new bootstrap.Modal(document.getElementById("userModal"));

  // Neuer Benutzer Button
  document.getElementById("newUserBtn").addEventListener("click", () => {
    document.getElementById("userForm").reset();
    document.getElementById("userId").value = "";
    document.getElementById("userModalTitle").textContent = "Neuen Benutzer erstellen";
    
    // Passwort-Hilfetext und Anforderung anpassen
    document.getElementById("user-password").required = true;
    document.getElementById("password-help-text").textContent = "Beim Erstellen eines neuen Benutzers erforderlich.";

    userModalInstance.show();
  });

  // Formular-Submit
  document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const id = document.getElementById("userId").value;
    const isUpdate = !!id;
    const url = isUpdate ? `/api/users/${id}` : "/api/users";
    const method = isUpdate ? "PUT" : "POST";

    const body = {
      username: document.getElementById("user-username").value,
      role: document.getElementById("user-role").value,
      notes: document.getElementById("user-notes").value,
    };

    // Passwort nur mitsenden, wenn es eingegeben wurde
    const password = document.getElementById("user-password").value;
    if (password) {
      body.password = password;
    } else if (!isUpdate) {
        // Beim Erstellen ist es Pflicht
        alert("Bitte geben Sie ein Passwort für den neuen Benutzer an.");
        return;
    }

    try {
      await apiFetch(url, { method, body: JSON.stringify(body) });
      userModalInstance.hide();
      loadUsers();
    } catch (error) {
      alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
  });
});

async function loadUsers() {
  const tbody = document.getElementById("users-table-body");
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Lade Benutzer...</td></tr>';

  try {
    const users = await apiFetch("/api/users");
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Keine Benutzer gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(user => {
        const roleBadge = user.role === 'admin' 
            ? '<span class="badge bg-danger">Admin</span>' 
            : '<span class="badge bg-secondary">Benutzer</span>';
        
        return `
            <tr>
                <td>${escapeHtml(user.username)}</td>
                <td>${roleBadge}</td>
                <td>${escapeHtml(user.notes)}</td>
                <td class="text-nowrap">
                    <button class="btn btn-sm btn-outline-secondary" onclick="editUser(${user.user_id})"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${user.user_id})"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `;
    }).join("");

  } catch (error) {
    console.error("Fehler beim Laden der Benutzer:", error);
    let errorMsg = "Laden der Benutzer fehlgeschlagen.";
    if (error.message.includes("403")) {
        errorMsg = "Zugriff verweigert. Sie benötigen Admin-Rechte.";
    }
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${errorMsg}</td></tr>`;
  }
}

async function editUser(id) {
  try {
    const user = await apiFetch(`/api/users/${id}`);
    
    document.getElementById("userForm").reset();
    document.getElementById("userModalTitle").textContent = "Benutzer bearbeiten";
    document.getElementById("userId").value = user.user_id;
    document.getElementById("user-username").value = user.username;
    document.getElementById("user-role").value = user.role;
    document.getElementById("user-notes").value = user.notes;

    // Passwort-Hilfetext und Anforderung anpassen
    document.getElementById("user-password").required = false;
    document.getElementById("user-password").value = ""; // WICHTIG: Passwortfeld leeren
    document.getElementById("password-help-text").textContent = "Leer lassen, um das Passwort nicht zu ändern.";

    userModalInstance.show();
  } catch (error) {
    alert(`Fehler beim Laden des Benutzers: ${error.message}`);
  }
}

async function deleteUser(id) {
  if (!confirm(`Möchten Sie diesen Benutzer wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;

  try {
    await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    loadUsers();
  } catch (error) {
    alert(`Löschen fehlgeschlagen: ${error.message}`);
  }
}
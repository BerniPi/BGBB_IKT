// public/js/settings.js

document.addEventListener("DOMContentLoaded", () => {
  // apiFetch ist in main.js global verfügbar
  if (typeof apiFetch === "undefined") {
    console.error("apiFetch ist nicht geladen. main.js fehlt.");
    return;
  }

  loadSettings();

  const form = document.getElementById("settingsForm");
  form.addEventListener("submit", saveSettings);
});

/**
 * Lädt alle Einstellungen vom Admin-Endpunkt und füllt das Formular.
 */
async function loadSettings() {
  try {
    // Ruft /api/settings/admin (wird von index.js gemappt)
    const settings = await apiFetch("/api/settings/admin");

    // Formularfelder befüllen
    // Text-/Input-Felder
    setValue("setting-default_ip_prefix", settings.default_ip_prefix);
    setValue("setting-system_email", settings.system_email);

    // Checkboxen/Switches
    setChecked("setting-maintenance_mode", settings.maintenance_mode === 'true');

  } catch (err) {
    alert(`Fehler beim Laden der Einstellungen: ${err.message}`);
  }
}

/**
 * Speichert alle Einstellungen.
 */
async function saveSettings(e) {
  e.preventDefault();
  const btn = document.getElementById("saveSettingsBtn");
  const status = document.getElementById("settings-save-status");
  
  // Zeige Lade-Spinner
  btn.disabled = true;
  status.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Speichere...';

  try {
    // Daten aus dem Formular sammeln
    const payload = {
      // Text-/Input-Felder
      "default_ip_prefix": getValue("setting-default_ip_prefix"),
      "system_email": getValue("setting-system_email"),
      
      // Checkboxen/Switches (als 'true'/'false' String speichern)
      "maintenance_mode": getChecked("setting-maintenance_mode") ? 'true' : 'false'
    };
    
    // Ruft PUT /api/settings/admin
    const result = await apiFetch("/api/settings/admin", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    // Zeige Erfolgsmeldung
    status.innerHTML = `<span class="text-success"><i class="bi bi-check-circle-fill"></i> ${result.message || "Gespeichert!"}</span>`;

  } catch (err) {
    // Zeige Fehlermeldung
    status.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle-fill"></i> ${err.message}</span>`;
  } finally {
    // Button wieder aktivieren
    btn.disabled = false;
    // Meldung nach 3 Sekunden ausblenden
    setTimeout(() => { status.innerHTML = ""; }, 3000);
  }
}


// --- Hilfsfunktionen (lokal, um Abhängigkeiten zu vermeiden) ---

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : null;
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) {
    el.value = val ?? "";
  }
}

function getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

function setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) {
        el.checked = !!val;
    }
}
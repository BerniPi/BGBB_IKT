// public/js/master-data-categories.js

// HIER: Umbenannt zu __catSort
let __catSort = { col: "category_name", dir: "asc" };

document.addEventListener('DOMContentLoaded', () => {
    window.loadData = loadCategories; // Global verfügbar machen
    loadCategories();
    
    document.getElementById('deviceCategoryForm').addEventListener('submit', handleCategoryFormSubmit);
    bindSortEvents();
});

function bindSortEvents() {
  document.querySelectorAll("th.sortable-header").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;
      
      // HIER: __catSort verwenden
      if (__catSort.col === col) {
        __catSort.dir = __catSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        __catSort.col = col;
        __catSort.dir = 'asc';
      }
      loadCategories();
    });
  });
}

function updateSortIndicators() {
    const table = document.querySelector("#device-categories-table-body").closest('table');
    if (!table) return;
    table.querySelectorAll(".sortable-header").forEach(header => {
        header.classList.remove("sort-asc", "sort-desc");
        
        // HIER: __catSort verwenden
        if (header.dataset.sort === __catSort.col) {
            header.classList.add(__catSort.dir === "asc" ? "sort-asc" : "sort-desc");
        }
    });
}

async function loadCategories() {
    updateSortIndicators();
    const tbody = document.getElementById('device-categories-table-body');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">Lade...</td></tr>`;
    
    try {
        const data = await apiFetch('/api/master-data/device_categories');

        // Frontend-Sortierung
        data.sort((a, b) => {
            // HIER: __catSort verwenden
            let valA = String(a[__catSort.col] || '').toLowerCase();
            let valB = String(b[__catSort.col] || '').toLowerCase();

            // Zahlen-Sortierung für die neuen Spalten
            const numericCols = ['model_count', 'active_devices', 'total_devices'];
            if (numericCols.includes(__catSort.col)) {
                valA = parseFloat(valA || 0);
                valB = parseFloat(valB || 0);
            } else {
            // ======================== ANPASSUNG ENDE =======================
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            if (valA < valB) return __catSort.dir === 'asc' ? -1 : 1;
            if (valA > valB) return __catSort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Keine Kategorien vorhanden.</td></tr>`;
            return;
        }
        tbody.innerHTML = data.map(renderCategoryRow).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Laden fehlgeschlagen: ${error.message}</td></tr>`;
    }
}

function renderCategoryRow(item) {
    const name = createEditableCell('device_categories', item.category_id, 'category_name', item.category_name);
    const description = createEditableCell('device_categories', item.category_id, 'description', item.description);
// Daten aus der API (Backend)
    const models = item.model_count;
    const devices = `${item.active_devices} (${item.total_devices})`;

    return `
        <tr>
            <td>${name}</td>
            <td>${description}</td>
            <td>${models}</td>
            <td>${devices}</td>
            <td>${createActionButtons('device_categories', 'category_id', item.category_id)}</td>
        </tr>
    `;
}

// Speichert das "Neue Kategorie anlegen"-Modal
async function handleCategoryFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    
    const body = {
        category_name: document.getElementById('cat-category_name').value,
        description: document.getElementById('cat-description').value || null,
    };

    try {
        await apiFetch('/api/master-data/device_categories', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        form.reset();
        bootstrap.Modal.getInstance(document.getElementById('categoryModal')).hide();
        loadCategories(); // Tabelle neu laden
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}
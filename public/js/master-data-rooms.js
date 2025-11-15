// public/js/master-data-rooms.js

document.addEventListener('DOMContentLoaded', () => {
    window.loadData = loadRooms; // Global verfügbar machen für common.js
    loadRooms();

    document.getElementById('roomForm').addEventListener('submit', handleRoomFormSubmit);
});

// Lädt und rendert die Räume
async function loadRooms() {
    const tbody = document.getElementById('rooms-table-body');
    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Lade...</td></tr>`;

    try {
        const data = await apiFetch('/api/master-data/rooms');
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Keine Räume vorhanden.</td></tr>`;
            return;
        }
        tbody.innerHTML = renderRoomsTable(data);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Laden fehlgeschlagen.</td></tr>`;
    }
}

// Rendert die Tabelle
function renderRoomsTable(data) {
    let html = '';
    let currentFloor = Symbol();
    data.forEach((item, index) => {
        if (item.floor !== currentFloor) {
            currentFloor = item.floor;
            html += `<tr class="table-light"><td colspan="7"><strong>Stockwerk: ${currentFloor === null ? 'Nicht definiert' : currentFloor}</strong></td></tr>`;
        }
        
        const prevItem = data[index - 1], nextItem = data[index + 1];
        const showUp = prevItem && prevItem.floor === item.floor;
        const showDown = nextItem && nextItem.floor === item.floor;
        const upArrow = showUp ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="moveRoom(${item.room_id}, 'up')"><i class="bi bi-arrow-up"></i></button>` : '';
        const downArrow = showDown ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="moveRoom(${item.room_id}, 'down')"><i class="bi bi-arrow-down"></i></button>` : '';

        const editableNameCell = createEditableCell('rooms', item.room_id, 'room_name', item.room_name);
        const editableNumberCell = createEditableCell('rooms', item.room_id, 'room_number', item.room_number);
        const editableFloorCell = createEditableCell('rooms', item.room_id, 'floor', item.floor);
        const editableSortCell = createEditableCell('rooms', item.room_id, 'sort_order', item.sort_order);

        const deviceCount = item.active_device_count || 0;
        const countBadge = deviceCount > 0 
            ? `<span class="badge bg-primary">${deviceCount}</span>` 
            : `<span class="text-muted">0</span>`;

        html += `<tr data-room-id="${item.room_id}">
            <td>${upArrow} ${downArrow}</td>
            <td>${editableNumberCell}</td>
            <td>${editableNameCell}</td>
            <td>${countBadge}</td>
            <td>${editableFloorCell}</td>
            <td>${editableSortCell}</td>
            <td>${createActionButtons('rooms', 'room_id', item.room_id)}</td>
        </tr>`;
    });
    return html;
}

// Speichert das "Neuen Raum anlegen"-Modal
async function handleRoomFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    
    const body = {
        room_number: document.getElementById('room-room_number').value,
        room_name: document.getElementById('room-room_name').value,
        floor: document.getElementById('room-floor').value || null,
        sort_order: document.getElementById('room-sort_order').value || null,
    };

    try {
        await apiFetch('/api/master-data/rooms', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        form.reset();
        bootstrap.Modal.getInstance(document.getElementById('roomModal')).hide();
        loadRooms(); // Tabelle neu laden
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}

// Raum verschieben
async function moveRoom(roomId, direction) {
    try {
        await apiFetch(`/api/master-data/rooms/${roomId}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
        await loadRooms();
        // Optional: Zum verschobenen Element scrollen
        const rowElement = document.querySelector(`tr[data-room-id="${roomId}"]`);
        if (rowElement) rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        alert('Raum konnte nicht verschoben werden: ' + (error.message || 'Unbekannter Fehler'));
    }
}
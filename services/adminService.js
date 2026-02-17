const { readDB, writeDB } = require('../database/adapter');

const registerGroup = (jid, name) => {
    if (!jid.endsWith('@g.us')) return;
    const db = readDB();
    const group = db.groups.find(g => g.id === jid);
    
    if (!group) {
        db.groups.push({ id: jid, name: name, joinedAt: new Date().toISOString() });
        writeDB(db);
        console.log(`🆕 Grupo registrado: ${name}`);
    }
};

const getGlobalStats = () => {
    const db = readDB();
    return `📊 *ESTADÍSTICAS GLOBALES*\n\n` +
           `👥 Usuarios: ${db.users.length}\n` +
           `🏙️ Grupos: ${db.groups.length}\n` +
           `📝 Tareas: ${db.tasks.length}`;
};

const getGroupList = () => {
    const db = readDB();
    if (db.groups.length === 0) return "No hay grupos registrados.";
    return db.groups.map((g, i) => `${i+1}. ${g.name} (${g.id})`).join('\n');
};

module.exports = { registerGroup, getGlobalStats, getGroupList };
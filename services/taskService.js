const { readDB, writeDB } = require('../database/adapter');
const { parseDate } = require('../utils/dateParser');

const checkUser = async (jid, pushName) => {
    const db = readDB();
    const user = db.users.find(u => u.id === jid);
    if (!user) {
        db.users.push({ id: jid, name: pushName, joinedAt: new Date().toISOString() });
        writeDB(db);
    }
};

const createTask = async (jid, text) => {
    let recurrence = null;
    let cleanText = text;

    const match = text.match(/-cada\s+(\d+)(m|h|d)/i);
    if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'm') recurrence = amount;
        if (unit === 'h') recurrence = amount * 60;
        if (unit === 'd') recurrence = amount * 60 * 24;
        cleanText = text.replace(match[0], '').trim();
    }

    const date = parseDate(cleanText);
    if (!date && !recurrence) return "⚠️ No entendí. Prueba: */tarea Agua -cada 45m*";

    const startDate = date ? date : new Date();

    const db = readDB();
    const newTask = {
        id: Date.now().toString(),
        description: cleanText,
        dueDate: startDate.toISOString(),
        recurrenceInterval: recurrence,
        lastReminded: null,
        isCompleted: false,
        userJid: jid
    };

    db.tasks.push(newTask);
    writeDB(db);

    let msg = `✅ *Anotado*`;
    if (date) msg += ` para: ${date.toLocaleString('es-CO')}`;
    if (recurrence) msg += `\n🔁 *Repetir:* Cada ${recurrence} min.`;
    return msg;
};

const listTasks = async (jid) => {
    const db = readDB();
    const tasks = db.tasks.filter(t => t.userJid === jid && !t.isCompleted);
    if (tasks.length === 0) return "🎉 Sin tareas pendientes.";
    
    let msg = `📋 *TU AGENDA*\n`;
    tasks.forEach((t, i) => {
        const dateObj = new Date(t.dueDate);
        const repeat = t.recurrenceInterval ? ` 🔁 Cada ${t.recurrenceInterval}m` : '';
        msg += `*${i + 1}.* ${t.description}${repeat}\n   🕒 ${dateObj.toLocaleString('es-CO')}\n`;
    });
    msg += `\n🗑️ /borrar [numero]`;
    return msg;
};

const deleteTask = async (jid, indexArg) => {
    const index = parseInt(indexArg) - 1;
    const db = readDB();
    const userTasks = db.tasks.filter(t => t.userJid === jid && !t.isCompleted);
    
    if (isNaN(index) || index < 0 || index >= userTasks.length) return "⚠️ Número inválido.";
    
    const taskToDelete = userTasks[index];
    db.tasks = db.tasks.filter(t => t.id !== taskToDelete.id);
    writeDB(db);
    return `🗑️ Eliminada.`;
};

const calculateNeededGrade = (args) => {
    const values = args.split(' ').map(n => parseFloat(n));
    if (values.length < 5) return "⚠️ Uso: */notaNecesaria* [N1] [P1] [N2] [P2] [P3]";

    const [n1, p1, n2, p2, p3] = values;
    if (p1 + p2 + p3 !== 100) return "⚠️ Los porcentajes deben sumar 100%.";

    let goal = 60; 
    if (n1 <= 5 && n2 <= 5) goal = 3.0;

    const currentTotal = (n1 * (p1 / 100)) + (n2 * (p2 / 100));
    const needed = (goal - currentTotal) / (p3 / 100);

    return `🧮 *CÁLCULO*\nLlevas: *${currentTotal.toFixed(2)}*\nMeta: *${goal}*\n😱 *NECESITAS: ${needed.toFixed(2)}*`;
};

module.exports = { checkUser, createTask, listTasks, deleteTask, calculateNeededGrade };
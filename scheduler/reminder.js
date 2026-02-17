const cron = require('node-cron');
const { readDB, writeDB } = require('../database/adapter');

const initScheduler = (sock) => {
    console.log('✅ Scheduler Dinámico Iniciado.');
    
    cron.schedule('* * * * *', async () => {
        const db = readDB();
        const now = new Date();
        let updated = false;

        for (let i = 0; i < db.tasks.length; i++) {
            const task = db.tasks[i];
            if (task.isCompleted) continue;

            const taskDate = new Date(task.dueDate);
            let shouldTrigger = false;

            if (!task.recurrenceInterval) {
                if (!task.reminderSent && taskDate <= now) {
                    shouldTrigger = true;
                    db.tasks[i].reminderSent = true;
                }
            } else {
                const lastRun = task.lastReminded ? new Date(task.lastReminded) : null;
                if (!lastRun) {
                    if (taskDate <= now) shouldTrigger = true;
                } else {
                    const diffMinutes = Math.floor((now - lastRun) / 1000 / 60);
                    if (diffMinutes >= task.recurrenceInterval) shouldTrigger = true;
                }
            }

            if (shouldTrigger) {
                console.log(`🔔 Enviando a ${task.userJid}`);
                let text = `⏰ *RECORDATORIO*\n\n📌 ${task.description}`;
                if (task.recurrenceInterval) {
                    text += `\n🔄 _Siguiente en ${task.recurrenceInterval} min_`;
                    db.tasks[i].lastReminded = now.toISOString();
                }

                try {
                    await sock.sendMessage(task.userJid, { text: text });
                    updated = true;
                } catch (e) {
                    console.error('Error enviando:', e);
                }
            }
        }
        if (updated) writeDB(db);
    });
};

module.exports = initScheduler;
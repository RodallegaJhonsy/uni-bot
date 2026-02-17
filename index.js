require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');

const { checkUser, createTask, listTasks, deleteTask, calculateNeededGrade } = require('./services/taskService');
const { registerGroup, getGlobalStats, getGroupList } = require('./services/adminService');
const initScheduler = require('./scheduler/reminder');
const { readDB } = require('./database/adapter');

const OWNER_NUMBER = process.env.OWNER_NUMBER;
const BOT_NUMBER = process.env.BOT_NUMBER; // El número que pondrás en .env

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // DESACTIVAMOS QR
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"] // Simula un navegador Linux (ideal para Termux)
    });

    // --- LÓGICA DE PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        // Esperamos un momento para asegurar conexión
        const codeDelay = 4000;
        console.log(`⏳ Esperando ${codeDelay/1000}s para generar código...`);
        await delay(codeDelay);

        // Solicitamos el código usando el número del .env
        if (BOT_NUMBER) {
            const code = await sock.requestPairingCode(BOT_NUMBER);
            console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            console.log(`🥂 TU CÓDIGO DE VINCULACIÓN: ${code}`);
            console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
        } else {
            console.log('❌ ERROR: Define BOT_NUMBER en tu archivo .env');
        }
    }

    initScheduler(sock);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ BOT CONECTADO VIA PAIRING CODE');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const userJid = m.key.remoteJid; 
        const pushName = m.pushName || 'Usuario';
        const msgText = m.message.conversation || m.message.extendedTextMessage?.text || '';

        // Registro de grupos
        if (userJid.endsWith('@g.us')) {
            registerGroup(userJid, 'Grupo WhatsApp'); 
        }

        if (!msgText.startsWith('/')) return;

        const commandBody = msgText.slice(1).trim(); 
        const [command, ...args] = commandBody.split(' ');
        const argsJoined = args.join(' ');

        // Verificación de Admin usando .includes (más seguro)
        const isAdmin = userJid.includes(OWNER_NUMBER);

        await checkUser(userJid, pushName);

        try {
            switch(command.toLowerCase()) {
                case 'menu':
                    const menu = `╭─── 📚 *UNI-BOT* ───
│ 👋 Hola, *${pushName}*
│
│ 📝 *AGENDA*
│ 🔹 */tarea* [descripción] -cada [tiempo]
│    _Ej: /tarea Pastilla -cada 8h_
│ 🔹 */lista* y */borrar*
│
│ 🧮 *CALCULADORAS*
│ 🔹 */notaNecesaria* [N1] [P1] [N2] [P2] [P3]
│
│ 👑 *ADMIN*
│ 🔹 */panel* (Solo dueño)
╰──────────────────`;
                    await sock.sendMessage(userJid, { text: menu });
                    break;

                case 'tarea':
                    const r1 = await createTask(userJid, argsJoined);
                    await sock.sendMessage(userJid, { text: r1 });
                    break;
                
                case 'lista':
                    const r2 = await listTasks(userJid);
                    await sock.sendMessage(userJid, { text: r2 });
                    break;

                case 'borrar':
                    const r3 = await deleteTask(userJid, argsJoined);
                    await sock.sendMessage(userJid, { text: r3 });
                    break;

                case 'notanecesaria':
                    const r4 = calculateNeededGrade(argsJoined);
                    await sock.sendMessage(userJid, { text: r4 });
                    break;

                case 'panel':
                    if (!isAdmin) return;
                    const panel = `👑 *PANEL DE ADMIN* 👑\n1️⃣ /statsGlobal\n2️⃣ /grupos\n3️⃣ /anuncioGlobal [msg]`;
                    await sock.sendMessage(userJid, { text: panel });
                    break;

                case 'statsglobal':
                    if (isAdmin) await sock.sendMessage(userJid, { text: getGlobalStats() });
                    break;

                case 'grupos':
                    if (isAdmin) await sock.sendMessage(userJid, { text: getGroupList() });
                    break;

                case 'anuncioglobal':
                    if (!isAdmin) return;
                    if (!argsJoined) return await sock.sendMessage(userJid, { text: '⚠️ Escribe el mensaje.' });
                    const db = readDB();
                    for (const group of db.groups) {
                        await sock.sendMessage(group.id, { text: `📢 *ANUNCIO*\n\n${argsJoined}` });
                    }
                    await sock.sendMessage(userJid, { text: `✅ Enviado.` });
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    });
}

connectToWhatsApp();
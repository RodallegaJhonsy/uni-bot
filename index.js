require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

const { checkUser, createTask, listTasks, deleteTask, calculateNeededGrade } = require('./services/taskService');
const { registerGroup, getGlobalStats, getGroupList } = require('./services/adminService');
const initScheduler = require('./scheduler/reminder');
const { readDB } = require('./database/adapter');

const OWNER_NUMBER = process.env.OWNER_NUMBER;
const BOT_NUMBER = process.env.BOT_NUMBER; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        // Usamos Mac Chrome para simular un PC estable
        browser: Browsers.macOS("Chrome"),
        markOnlineOnConnect: true,
        mobile: false, 
        syncFullHistory: false,
        retryRequestDelayMs: 2000, 
        keepAliveIntervalMs: 10000, // Mantiene la conexión viva
        connectTimeoutMs: 60000, 
    });

    // --- LÓGICA DE PAIRING CODE MEJORADA ---
    if (!sock.authState.creds.registered) {
        
        // Espera inicial para estabilizar
        await delay(3000);

        if (BOT_NUMBER) {
            try {
                // Verificamos si el socket está abierto antes de pedir
                console.log('⏳ Generando código (No cambies de App todavía)...');
                
                const code = await sock.requestPairingCode(BOT_NUMBER);
                
                console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
                console.log(`🥂 CÓDIGO:   ${code}`);
                console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
                console.log('⚡ CORRE: Tienes 60s (Usa Pantalla Dividida si puedes) ⚡');
                
            } catch (err) {
                // SI FALLA AL CAMBIAR DE APP, NO SE ROMPE
                console.log('⚠️ La conexión se pausó (¿Cambiaste de app?).');
                console.log('🔄 Reintentando en 5 segundos...');
                await delay(5000);
            }
        }
    }

    initScheduler(sock);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            // Lógica de reconexión mejorada
            const reason = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Desconectado (${reason}). Reconectando: ${shouldReconnect}`);

            if (shouldReconnect) {
                // Espera progresiva para no saturar
                await delay(3000);
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ BOT CONECTADO Y LISTO');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const userJid = m.key.remoteJid; 
        const pushName = m.pushName || 'Usuario';
        const msgText = m.message.conversation || m.message.extendedTextMessage?.text || '';

        if (userJid.endsWith('@g.us')) registerGroup(userJid, 'Grupo'); 

        if (!msgText.startsWith('/')) return;

        const commandBody = msgText.slice(1).trim(); 
        const [command, ...args] = commandBody.split(' ');
        const argsJoined = args.join(' ');
        const isAdmin = OWNER_NUMBER ? userJid.includes(OWNER_NUMBER) : false;

        await checkUser(userJid, pushName);

        try {
            switch(command.toLowerCase()) {
                case 'menu':
                    const menu = `╭─── 📚 *UNI-BOT* ───
│ 👋 Hola, *${pushName}*
│
│ 📝 *AGENDA*
│ 🔹 */tarea* [descripción] -cada [tiempo]
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
                    await sock.sendMessage(userJid, { text: await createTask(userJid, argsJoined) });
                    break;
                case 'lista':
                    await sock.sendMessage(userJid, { text: await listTasks(userJid) });
                    break;
                case 'borrar':
                    await sock.sendMessage(userJid, { text: await deleteTask(userJid, argsJoined) });
                    break;
                case 'notanecesaria':
                    await sock.sendMessage(userJid, { text: calculateNeededGrade(argsJoined) });
                    break;
                case 'panel':
                    if (isAdmin) await sock.sendMessage(userJid, { text: `👑 *PANEL*\n1️⃣ /statsGlobal\n2️⃣ /grupos\n3️⃣ /anuncioGlobal` });
                    break;
                case 'statsglobal':
                    if (isAdmin) await sock.sendMessage(userJid, { text: getGlobalStats() });
                    break;
                case 'grupos':
                    if (isAdmin) await sock.sendMessage(userJid, { text: getGroupList() });
                    break;
                case 'anuncioglobal':
                    if (!isAdmin) return;
                    if (!argsJoined) return await sock.sendMessage(userJid, { text: '⚠️ Falta mensaje.' });
                    const db = readDB();
                    for (const group of db.groups) await sock.sendMessage(group.id, { text: `📢 ${argsJoined}` });
                    await sock.sendMessage(userJid, { text: `✅ Enviado.` });
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    });
}

connectToWhatsApp();

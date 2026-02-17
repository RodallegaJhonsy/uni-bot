require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Importamos servicios y base de datos
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
        printQRInTerminal: false, // NO QR
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: Browsers.ubuntu("Chrome"), // Navegador Linux estándar
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        retryRequestDelayMs: 5000, // Esperar 5s si falla una petición
        connectTimeoutMs: 60000,   // Darle 60s para conectar (útil en Termux)
    });

    // --- LÓGICA DE PAIRING CODE ---
    // Solo pedimos código si NO estamos registrados y NO estamos conectando ya
    if (!sock.authState.creds.registered) {
        
        if (!BOT_NUMBER) {
            console.log('❌ ERROR: Define BOT_NUMBER en tu archivo .env');
            process.exit(1);
        }

        // Esperamos 5 segundos para asegurar que el socket esté listo
        const codeDelay = 5000;
        console.log(`⏳ Esperando ${codeDelay/1000}s para generar código...`);
        await delay(codeDelay);

        try {
            // Pedimos el código
            const code = await sock.requestPairingCode(BOT_NUMBER);
            console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            console.log(`🥂 TU CÓDIGO:   ${code}`);
            console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
            console.log('⚡ TIENES 60 SEGUNDOS PARA PONERLO EN WHATSAPP ⚡');
        } catch (err) {
            console.log('⚠️ No se pudo generar el código (Error de conexión).');
            console.log('👉 Intenta reiniciar con: node index.js');
        }
    }

    initScheduler(sock);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada. ¿Reconectar?: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // ESPERAMOS 5 SEGUNDOS ANTES DE RECONECTAR (Anti-Crash)
                console.log('⏳ Esperando 5s para reconectar...');
                await delay(5000);
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ BOT CONECTADO Y ESTABLE');
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
                    for (const group of db.groups) {
                        await sock.sendMessage(group.id, { text: `📢 ${argsJoined}` });
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

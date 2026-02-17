require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

const { checkUser, createTask, listTasks, deleteTask, calculateNeededGrade } = require('./services/taskService');
const { registerGroup, getGlobalStats, getGroupList } = require('./services/adminService');
const initScheduler = require('./scheduler/reminder');
const { readDB } = require('./database/adapter');

const OWNER_NUMBER = process.env.OWNER_NUMBER;
const BOT_NUMBER = process.env.BOT_NUMBER; 

// --- CANDADO DE SEGURIDAD ---
// Esto evita que el bot pida el código 2 veces y se crashee
let isPairingCodeRequested = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        retryRequestDelayMs: 5000, 
        connectTimeoutMs: 60000, 
    });

    // --- LÓGICA DE PAIRING CODE BLINDADA ---
    if (!sock.authState.creds.registered) {
        
        // Si ya pedimos el código, NO hacemos nada (Evita el error 428)
        if (!isPairingCodeRequested) {
            isPairingCodeRequested = true; // 🔒 CERRAMOS EL CANDADO

            if (!BOT_NUMBER) {
                console.log('❌ ERROR: Define BOT_NUMBER en tu archivo .env');
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    console.log('⏳ Iniciando protocolo de vinculación...');
                    await delay(4000); // Esperamos a que la conexión sea estable
                    
                    const code = await sock.requestPairingCode(BOT_NUMBER);
                    
                    console.clear();
                    console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
                    console.log(`🥂 TU CÓDIGO:   ${code}`);
                    console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
                    console.log('⚡ NO CIERRES ESTA PANTALLA ⚡');

                } catch (err) {
                    console.log('⚠️ Error al pedir código. Reinicia el bot manualmente.');
                    isPairingCodeRequested = false; // Abrimos candado por si falló real
                }
            }, 3000);
        }
    }

    initScheduler(sock);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Conexión inestable (${reason})...`);
            
            if (shouldReconnect) {
                // Si estamos en proceso de vinculación, NO reconectamos agresivamente
                if (isPairingCodeRequested && !sock.authState.creds.registered) {
                    console.log('⏳ Esperando a que vincules...');
                } else {
                    await delay(3000);
                    connectToWhatsApp();
                }
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
                    const menu = `╭─── 📚 *UNI-BOT* ───\n│ 👋 Hola *${pushName}*\n│\n│ 📝 */tarea* [desc] -cada [tiempo]\n│ 📝 */lista* y */borrar*\n│ 🧮 */notaNecesaria*\n│ 👑 */panel* (Admin)\n╰──────────────────`;
                    await sock.sendMessage(userJid, { text: menu });
                    break;
                case 'tarea': await sock.sendMessage(userJid, { text: await createTask(userJid, argsJoined) }); break;
                case 'lista': await sock.sendMessage(userJid, { text: await listTasks(userJid) }); break;
                case 'borrar': await sock.sendMessage(userJid, { text: await deleteTask(userJid, argsJoined) }); break;
                case 'notanecesaria': await sock.sendMessage(userJid, { text: calculateNeededGrade(argsJoined) }); break;
                case 'panel': if (isAdmin) await sock.sendMessage(userJid, { text: `👑 *PANEL*\n1️⃣ /statsGlobal\n2️⃣ /grupos\n3️⃣ /anuncioGlobal` }); break;
                case 'statsglobal': if (isAdmin) await sock.sendMessage(userJid, { text: getGlobalStats() }); break;
                case 'grupos': if (isAdmin) await sock.sendMessage(userJid, { text: getGroupList() }); break;
                case 'anuncioglobal':
                    if (!isAdmin) return;
                    const db = readDB();
                    for (const group of db.groups) await sock.sendMessage(group.id, { text: `📢 ${argsJoined}` });
                    await sock.sendMessage(userJid, { text: `✅ Enviado.` });
                    break;
            }
        } catch (e) { console.error(e); }
    });
}

connectToWhatsApp();

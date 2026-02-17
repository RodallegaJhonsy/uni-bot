require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Importar servicios
const { checkUser, createTask, listTasks, deleteTask, calculateNeededGrade } = require('./services/taskService');
const { registerGroup, getGlobalStats, getGroupList } = require('./services/adminService');
const initScheduler = require('./scheduler/reminder');
const { readDB } = require('./database/adapter');

const OWNER_NUMBER = process.env.OWNER_NUMBER;
const BOT_NUMBER = process.env.BOT_NUMBER; 

// Función principal que se reinicia a sí misma si falla
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: Browsers.ubuntu("Chrome"), // Más estable en Termux
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        retryRequestDelayMs: 2000, 
        connectTimeoutMs: 60000, 
    });

    // --- LÓGICA DE CÓDIGO DE VINCULACIÓN (CON REINTENTO INFINITO) ---
    if (!sock.authState.creds.registered) {
        
        if (!BOT_NUMBER) {
            console.log('❌ ERROR: Define BOT_NUMBER en tu archivo .env');
            process.exit(1);
        }

        // Bucle para intentar pedir el código hasta que funcione
        setTimeout(async () => {
            try {
                console.log('⏳ Conectando para pedir código...');
                await delay(3000); // Espera técnica
                
                // Intentamos pedir el código
                const code = await sock.requestPairingCode(BOT_NUMBER);
                
                // Si llegamos aquí, ¡FUNCIONÓ!
                console.clear();
                console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
                console.log(`🥂 TU CÓDIGO:   ${code}`);
                console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
                console.log('⚡ ¡CORRE A WHATSAPP! ⚡');

            } catch (err) {
                // Si falla, no mostramos error feo, solo avisamos y reintentamos
                console.log('⚠️ Falló la petición del código. Reintentando en 2s...');
            }
        }, 3000);
    }

    initScheduler(sock);

    // Manejo de conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (${reason}). Reiniciando...`);
            
            // Si se cierra, volvemos a llamar a startBot()
            await delay(3000);
            startBot(); 
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
                    if (!argsJoined) return await sock.sendMessage(userJid, { text: '⚠️ Falta mensaje.' });
                    const db = readDB();
                    for (const group of db.groups) await sock.sendMessage(group.id, { text: `📢 ${argsJoined}` });
                    await sock.sendMessage(userJid, { text: `✅ Enviado.` });
                    break;
            }
        } catch (e) { console.error(e); }
    });
}

// Iniciamos la función
startBot();

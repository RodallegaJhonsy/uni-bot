const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
require('dotenv').config();

const BOT_NUMBER = process.env.BOT_NUMBER;

async function start() {
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
        connectTimeoutMs: 60000,
    });

    if (!sock.authState.creds.registered) {
        console.log('⏳ Esperando 10 segundos para estabilizar conexión...');
        // Esperamos MUCHO tiempo para que WhatsApp no nos rechace
        await delay(10000); 

        try {
            if (!BOT_NUMBER) throw new Error('Falta BOT_NUMBER en .env');
            
            console.log('📡 Pidiendo código ahora...');
            const code = await sock.requestPairingCode(BOT_NUMBER);
            
            console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            console.log(`🥂 CÓDIGO:  ${code}`);
            console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
        } catch (err) {
            console.log('❌ Error:', err.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('✅ ¡VINCULACIÓN EXITOSA! Ya puedes cerrar esto.');
            process.exit(0); // Se cierra solo si funciona
        }
        if (connection === 'close') {
            console.log('⚠️ Conexión cerrada. Si no viste el código, intenta de nuevo.');
        }
    });
}

start();

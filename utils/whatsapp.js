const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

let sock;

// 🔥 NAYA JUGAAD: Auto Storage Manager (Bina logout kiye unused files clean karega)
function cleanOldSessionData() {
    const sessionDir = 'auth_info_baileys';
    if (!fs.existsSync(sessionDir)) return;

    try {
        const files = fs.readdirSync(sessionDir);
        const now = Date.now();
        const MAX_AGE = 14 * 24 * 60 * 60 * 1000; // 14 Days in milliseconds
        let deletedCount = 0;

        files.forEach(file => {
            // Main login file (creds.json) ko chhod kar, sirf purani temporary keys ko target karo
            if (file.startsWith('pre-key-') || file.startsWith('sender-key-') || file.startsWith('app-state-sync-') || file.startsWith('session-')) {
                const filePath = path.join(sessionDir, file);
                const stats = fs.statSync(filePath);
                
                // Agar file 14 din se zyada purani hai (koi update nahi hua), toh uda do
                if (now - stats.mtimeMs > MAX_AGE) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
        });

        if (deletedCount > 0) {
            console.log(`🧹 [Storage Manager] Auto-Cleaned ${deletedCount} unused old key files. Storage saved!`);
        }
    } catch (err) {
        console.error('⚠️ [Storage Manager] Cleanup error:', err.message);
    }
}

async function connectToWhatsApp() {
    try {
        // Startup par ek baar safai karo
        cleanOldSessionData();

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        
        console.log(`\nStarting WA Engine (v${version.join('.')}, latest: ${isLatest})`);
        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'error' }), // 🔥 Sirf kaam ke errors dikhayega
            browser: ["VerifyHub Admin", "Chrome", "1.0.0"],
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.clear(); 
                console.log('\n=================================================');
                console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP');
                console.log('=================================================\n');
                qrcode.generate(qr, { small: true });
                console.log('\n(Waiting for scan...)\n');
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ Connection Closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    // 🕒 3 second ka delay taaki loop fast na ho
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else {
                    console.log('🚫 Logged out. Automatically clearing old session data...');
                    
                    try {
                        // Automatically delete the old auth folder
                        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                        console.log('✅ Old session cleared successfully. Generating fresh QR code...');
                    } catch (err) {
                        console.error('⚠️ Could not delete auth folder automatically:', err.message);
                    }
                    
                    // Restart to generate a new QR code immediately
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                console.clear();
                console.log('✅ ===========================================');
                console.log('✅ WhatsApp Connected Successfully!');
                console.log('✅ ===========================================\n');
                
                // Connection open hone ke baad har 24 ghante me auto-cleaner chalao
                if (!global.storageManagerInterval) {
                    global.storageManagerInterval = setInterval(cleanOldSessionData, 24 * 60 * 60 * 1000); // 24 Hours
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch (err) {
        console.error("Critical WA Startup Error:", err);
        setTimeout(connectToWhatsApp, 5000);
    }
}

async function sendAutoWaMessage(phone, text) {
    if (!sock) {
        console.log("❌ WhatsApp Engine not connected!");
        return false;
    }
    try {
        const jid = `91${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: text });
        console.log(`🚀 Message sent to: ${phone}`);
        return true;
    } catch (err) {
        console.error("❌ Send Error:", err.message);
        return false;
    }
}

// 🔥 ADVANCED GRACEFUL SHUTDOWN LOGIC
async function gracefulShutdown(reason) {
    console.log(`\n🛑 Server band ho raha hai. Reason: ${reason}`);
    try {
        if (sock) {
            console.log('💾 WhatsApp session files properly save ki jaa rahi hain...');
            sock.ev.flush(); // Flush any pending auth key updates to disk
            if (sock.ws) {
                sock.ws.close(); // WebSocket ko safely close karo bina logout bheje
            }
        }
    } catch (e) {
        console.error('⚠️ Error during shutdown:', e.message);
    }
    
    // Thoda wait karke close karo taaki file system write finish kar sake
    setTimeout(() => {
        console.log('✅ Session Saved. Server completely stopped.');
        process.exit(reason === 'Crash' ? 1 : 0);
    }, 1000);
}

// 1. Ctrl + C in terminal
process.on('SIGINT', () => gracefulShutdown('SIGINT (Ctrl+C)'));

// 2. Terminal achanak close kar dena ya background kill
process.on('SIGTERM', () => gracefulShutdown('SIGTERM (Terminal Closed)'));

// 3. Syntax Error ya koi Runtime Crash
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception (App Crashed):', err.message);
    gracefulShutdown('Crash');
});

// 4. Unhandled Promise Rejection
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    gracefulShutdown('Crash');
});

module.exports = { connectToWhatsApp, sendAutoWaMessage };
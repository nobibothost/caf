const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const mongoose = require('mongoose');

// Database model for adding entries
const Customer = require('../models/Customer'); 

let sock;
let currentQr = null;     
let isConnected = false;  

// Temporary memory for WhatsApp text commands
const pendingEntries = {};

// 🔥 BACKEND IN-MEMORY CACHE FOR DPs
const backendDpCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Hours Cache

function getWaState() {
    return { isConnected, qr: currentQr };
}

// =====================================================================
// NEW HELPERS FOR BOT RELIABILITY
// =====================================================================

// Wait up to 2 minutes for connection to establish
const waitForConnection = async () => {
    let attempts = 0;
    while (!isConnected && attempts < 24) { // 24 * 5s = 120s (2 mins)
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
    }
    return isConnected;
};

// Deep extraction to bypass Disappearing Messages (Ephemeral)
const extractText = (msg) => {
    if (!msg.message) return "";
    return msg.message.conversation || 
           msg.message.extendedTextMessage?.text || 
           msg.message.ephemeralMessage?.message?.extendedTextMessage?.text ||
           msg.message.ephemeralMessage?.message?.conversation || 
           "";
};

// =====================================================================
// THE JUGAAD: CUSTOM MONGODB AUTH ENGINE & SMART CLEANER
// =====================================================================

const waAuthSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: String, required: true }, 
    updatedAt: { type: Date, default: Date.now }
});

waAuthSchema.index(
    { updatedAt: 1 }, 
    { expireAfterSeconds: 7 * 24 * 60 * 60, partialFilterExpression: { _id: { $ne: 'creds' } } }
);

const WaAuth = mongoose.models.WaAuth || mongoose.model('WaAuth', waAuthSchema);

const useMongoDBAuthState = async () => {
    const readData = async (id) => {
        try {
            const doc = await WaAuth.findById(id);
            return doc ? JSON.parse(doc.data, BufferJSON.reviver) : null;
        } catch (error) { return null; }
    };
    
    const writeData = async (id, data) => {
        const strData = JSON.stringify(data, BufferJSON.replacer);
        await WaAuth.findByIdAndUpdate(id, { data: strData, updatedAt: new Date() }, { upsert: true });
    };
    
    const removeData = async (id) => {
        await WaAuth.findByIdAndDelete(id);
    };

    let creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async id => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        if (value) data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const docId = `${category}-${id}`;
                            if (value) tasks.push(writeData(docId, value));
                            else tasks.push(removeData(docId));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds)
    };
};

async function cleanMongoSessionData() {
    try {
        const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const result = await WaAuth.deleteMany({
            _id: { $ne: 'creds' },
            updatedAt: { $lt: SEVEN_DAYS_AGO }
        });
        if (result.deletedCount > 0) {
            console.log(`🧹 [MongoDB Cleaner] Auto-Cleaned ${result.deletedCount} old keys.`);
        }
    } catch (err) {
        console.error('⚠️ [MongoDB Cleaner] Error:', err.message);
    }
}

// =====================================================================
// MAIN WHATSAPP CONNECTION LOGIC
// =====================================================================

async function connectToWhatsApp() {
    try {
        await cleanMongoSessionData();

        const { state, saveCreds } = await useMongoDBAuthState();
        const { version, isLatest } = await fetchLatestBaileysVersion();
        
        console.log(`\n🚀 Starting Cloud WA Engine (v${version.join('.')}) - Session backed by MongoDB!`);
        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'error' }), 
            browser: ["VerifyHub Admin", "Chrome", "1.0.0"],
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                currentQr = qr;      
                isConnected = false; 
                
                console.log('\n=================================================');
                console.log('📱 SCAN THIS QR CODE WITH YOUR WHATSAPP');
                console.log('=================================================\n');
                qrcode.generate(qr, { small: true });
                console.log('\n(Waiting for scan...)\n');
            }
            
            if (connection === 'close') {
                isConnected = false; 
                currentQr = null;    
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ Connection Closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else {
                    console.log('🚫 Logged out. Automatically wiping DB session data...');
                    try {
                        await WaAuth.deleteMany({});
                        console.log('✅ Old DB session wiped successfully. Generating fresh QR code...');
                    } catch (err) {
                        console.error('⚠️ Could not wipe DB auth data:', err.message);
                    }
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                isConnected = true;  
                currentQr = null;    
                
                console.log('\n✅ ===========================================');
                console.log('✅ Cloud WhatsApp Connected Successfully!');
                console.log('✅ ===========================================\n');
                
                if (!global.storageManagerInterval) {
                    global.storageManagerInterval = setInterval(cleanMongoSessionData, 24 * 60 * 60 * 1000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // =====================================================================
        // WHATSAPP NATURAL LANGUAGE TEXT BOT & WAIT LOGIC
        // =====================================================================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg || msg.key.fromMe) return;

                const senderJid = msg.key.remoteJid;
                if (!senderJid) return;
                
                // Normalizing sender number to strictly check with 91
                let cleanSender = senderJid.split('@')[0].replace(/\D/g, ''); 
                if (cleanSender.length === 10) cleanSender = '91' + cleanSender; 

                // Normalizing admin number from environment variable
                let cleanAdmin = String(process.env.ADMIN_WA_NUMBER || "8657973703").replace(/\D/g, '');
                if (cleanAdmin.length === 10) cleanAdmin = '91' + cleanAdmin; 
                
                // Block unauthorized numbers instantly
                if (cleanSender !== cleanAdmin) return;

                // WAIT UP TO 2 MINUTES IF NOT FULLY CONNECTED
                const isReadyNow = await waitForConnection();
                if (!isReadyNow) {
                    console.log("⏳ WhatsApp took too long to connect. Dropped message.");
                    return;
                }

                // Deep Text Extract (Bypasses Disappearing Messages)
                const text = extractText(msg);
                if (!text) return;

                const replyText = text.trim().toLowerCase();

                // 1. Check for YES/NO Confirmation
                if (pendingEntries[senderJid]) {
                    if (['yes', 'y', 'ha', 'haan', 'm yes'].includes(replyText)) {
                        const data = pendingEntries[senderJid];
                        
                        // Database Save Logic (Adding single SIM count)
                        const newCustomer = new Customer({
                            name: data.name,
                            mobile: data.mobile,
                            category: data.isFamily ? 'Family' : data.type,
                            subType: data.type, 
                            gender: 'KEEP',
                            status: 'pending',
                            createdAt: new Date(),
                            activationDate: new Date(),
                            plan: data.isFamily ? '701' : '451'
                        });
                        
                        await newCustomer.save();
                        
                        const ackMsg = `✅ Entry saved successfully!\n👤 *${data.name}* (${data.mobile})\n📌 ${data.isFamily ? 'Family ' + data.type : data.type}\n📊 Gross count mein +1 SIM add ho gayi hai.`;
                        await sock.sendMessage(senderJid, { text: ackMsg });
                        
                        delete pendingEntries[senderJid];
                        return;
                    } else if (['no', 'n', 'na', 'nahi'].includes(replyText)) {
                        delete pendingEntries[senderJid];
                        await sock.sendMessage(senderJid, { text: `❌ Entry cancel kar di gayi hai.` });
                        return;
                    }
                }

                // 2. Natural Language Processing Flow
                const numberMatch = text.match(/\b[6-9]\d{9}\b/);
                if (!numberMatch) return; 

                const mobile = numberMatch[0];
                const upperText = text.toUpperCase();
                
                let type = 'NC';
                if (upperText.includes('MNP')) type = 'MNP';
                else if (upperText.includes('NMNP')) type = 'NMNP';
                else if (upperText.includes('P2P')) type = 'P2P';
                else if (upperText.includes('PDR')) type = 'PDR';

                const isFamily = upperText.includes('FAMILY');

                // Name extraction by removing stop words
                let nameText = text.replace(mobile, '');
                const stopWords = ['ka', 'ko', 'naya', 'add', 'kar', 'do', 'kardo', 'hai', 'number', 'entry', 'ye', 'yeh', 'mera', 'family', 'mnp', 'nmnp', 'p2p', 'pdr', 'nc', 'please', 'plz', 'karo', 'karna', 'ek', 'meri'];
                
                let words = nameText.split(/\s+/).filter(w => {
                    let cleanWord = w.toLowerCase().replace(/[^a-z]/g, '');
                    return cleanWord.length > 0 && !stopWords.includes(cleanWord);
                });

                let name = words.length > 0 ? words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : 'Customer';

                pendingEntries[senderJid] = { name, mobile, type, isFamily };

                // Apply correct DD/MM/YYYY date formatting
                const today = new Date();
                const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

                const confirmText = `📝 *Nayi Entry Ka Format:*\n\n👤 *Name:* ${name}\n📱 *Number:* ${mobile}\n📌 *Type:* ${isFamily ? 'Family ' + type : type}\n📅 *Date:* ${formattedDate}\n\nKya ise save karna hai? *(Yes / No)*`;
                await sock.sendMessage(senderJid, { text: confirmText });

            } catch (error) {
                console.error('WhatsApp Bot AI Error:', error);
            }
        });

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
        let clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) clean = '91' + clean;
        const jid = `${clean}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: text });
        console.log(`🚀 Message sent to: ${phone}`);
        return true;
    } catch (err) {
        console.error("❌ Send Error:", err.message);
        return false;
    }
}

async function getProfilePicUrl(phone) {
    if (!sock) return null;
    try {
        let clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) clean = '91' + clean;
        
        if (backendDpCache.has(clean)) {
            const cached = backendDpCache.get(clean);
            if (Date.now() - cached.timestamp < CACHE_TTL) {
                return cached.url; 
            } else {
                backendDpCache.delete(clean); 
            }
        }

        const jid = `${clean}@s.whatsapp.net`;
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
        const fetchPic = sock.profilePictureUrl(jid, 'image');
        
        const url = await Promise.race([fetchPic, timeout]);
        
        backendDpCache.set(clean, { url: url, timestamp: Date.now() });

        return url;
    } catch (err) {
        let clean = String(phone).replace(/\D/g, '');
        if (clean.length === 10) clean = '91' + clean;
        backendDpCache.set(clean, { url: null, timestamp: Date.now() });
        return null;
    }
}

async function gracefulShutdown(reason) {
    console.log(`\n🛑 Server band ho raha hai. Reason: ${reason}`);
    try {
        if (sock) {
            console.log('💾 WhatsApp DB session safely closing...');
            sock.ev.flush(); 
            if (sock.ws) {
                sock.ws.close(); 
            }
        }
    } catch (e) {
        console.error('⚠️ Error during shutdown:', e.message);
    }
    
    setTimeout(() => {
        console.log('✅ Session Saved. Server completely stopped.');
        process.exit(reason === 'Crash' ? 1 : 0);
    }, 1000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT (Ctrl+C)'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM (Terminal Closed)'));
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception (App Crashed):', err.message);
    gracefulShutdown('Crash');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    gracefulShutdown('Crash');
});

module.exports = { connectToWhatsApp, sendAutoWaMessage, getWaState, getProfilePicUrl };
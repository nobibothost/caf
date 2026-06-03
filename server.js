require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit'); 
const cors = require('cors'); 
const os = require('os'); // Added for network ip extraction

// --- Import Modular Routes & Models ---
const authRoutes = require('./routes/authRoutes');
const aiRoutes = require('./routes/aiRoutes');
const Customer = require('./models/Customer'); 

// --- Import Security Middleware ---
const requireAuth = require('./middleware/auth');

// --- Import Helpers, WhatsApp Engine & Scheduler ---
const { connectToWhatsApp, getWaState } = require('./utils/whatsapp'); 
const { startCronJobs } = require('./utils/scheduler'); 

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

// --- CORS & SECURITY OPENED FOR ANDROID DESIGNING ---
app.use(cors({
    origin: '*', // Allows cross platform handshake for design pipelines
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({ 
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xPoweredBy: false 
}));

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 800, 
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    standardHeaders: true, 
    legacyHeaders: false, 
});
app.use(globalLimiter);

const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 20, 
    message: 'Too many login attempts. Try again in 10 minutes.'
});
app.use('/login', authLimiter);
app.use('/verify-otp', authLimiter);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.set('trust proxy', 1);

// --- SESSION SETUP (PWA Persistent Fix) ---
app.use(session({
    secret: SESSION_SECRET,
    name: 'vHub_session', 
    resave: true, 
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 365 * 24 * 60 * 60, 
        autoRemove: 'native',
        touchAfter: 1
    }),
    cookie: { 
        httpOnly: true, 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        sameSite: 'lax', 
        secure: process.env.NODE_ENV === 'production' 
    }
}));

// --- DB CONNECTION ---
const connectDB = async () => {
    try { 
        await mongoose.connect(MONGO_URI, { 
            maxPoolSize: 10, minPoolSize: 2, socketTimeoutMS: 45000, serverSelectionTimeoutMS: 5000, family: 4              
        });
        console.log('✅ MongoDB Connected'); 
        
        Customer.collection.createIndex({ mobile: 1 }).catch(()=>{});
        Customer.collection.createIndex({ name: 1 }).catch(()=>{});
        Customer.collection.createIndex({ status: 1, activationDate: -1 }).catch(()=>{});
        Customer.collection.createIndex({ category: 1 }).catch(()=>{});
        console.log('⚡ Smart Indexes Activated: Search & Load optimized!');
        
    } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); setTimeout(connectDB, 5000); }
};
connectDB();

// --- GLOBAL ROUTES & MOUNTING ---
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/power-off', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Server Stopped</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
        </head>
        <body style="font-family:'Inter', sans-serif; text-align:center; padding:50px 20px; background:#f8fafc; color:#0f172a; display:flex; flex-direction:column; align-items:center; justify-content:center; height:80vh; margin:0;">
            <div style="font-size:4.5rem; color:#ef4444; margin-bottom:15px;"><i class="ri-shut-down-line"></i></div>
            <h2 style="margin:0 0 10px 0; font-size:1.5rem;">Server Turned Off</h2>
            <p style="color:#64748b; font-size:0.95rem; max-width:300px; line-height:1.5;">Termux session aur WhatsApp channel state closed.</p>
        </body>
        </html>
    `);
    console.log("🛑 Server shutdown requested via Web UI. Exiting in 1 second...");
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// 1. PUBLIC ROUTES
app.use('/', authRoutes);

// 🔒 THE IRON GATE: Authenticated Scope
app.use(requireAuth); 

// 🔥 API FOR REAL-TIME WA STATUS INDICATOR
app.get('/api/wa-status', (req, res) => {
    const waState = getWaState();
    res.json({ isConnected: waState.isConnected });
});

// 🔥 SECURE WHATSAPP STATUS ROUTE
app.get('/whatsapp', (req, res) => {
    const waState = getWaState();
    res.render('whatsapp', { 
        isConnected: waState.isConnected, 
        qr: waState.qr, 
        page: 'whatsapp' 
    });
});

// 2. PRIVATE ROUTES
app.use('/api/ai', aiRoutes);
app.use('/', require('./routes/viewRoutes'));
app.use('/', require('./routes/actionRoutes')); 
app.use('/', require('./routes/billingRoutes'));
app.use('/', require('./routes/reportRoutes'));

app.get('*', (req, res) => { 
    if (req.headers['accept'] === 'application/json' || req.headers['authorization']) {
        return res.status(404).json({ success: false, error: 'Resource not found' });
    }
    res.redirect('/'); 
});

// --- PUBLIC ROUTING & SERVER INITIALIZATION ---
// Listening on '0.0.0.0' allows external network or mobile interface hits
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==================================================`);
    console.log(`🚀 VerifyHub Backend Is Active Globally!`);
    console.log(`==================================================`);
    
    // Dynamic network parsing logic block
    const interfaces = os.networkInterfaces();
    let ipFound = false;
    
    Object.keys(interfaces).forEach((interfaceName) => {
        interfaces[interfaceName].forEach((iface) => {
            // Filter internal loopbacks and isolate IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`📡 Connected Interface [${interfaceName}]: http://${iface.address}:${PORT}`);
                ipFound = true;
            }
        });
    });
    
    if (!ipFound) {
        console.log(`🔗 Isolated Device Mode Loopback: http://127.0.0.1:${PORT}`);
    }
    console.log(`==================================================\n`);
    
    connectToWhatsApp();
    startCronJobs();
});

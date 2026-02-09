require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

/* ==========================================================================
   🔥 BUSINESS LOGIC & RULES 🔥
   ========================================================================== */
const RULES = {
    ACTIVATION_DELAY: {
        'NC': 0,          // Instant
        'P2P': 0,         // Instant
        'MNP': 3,         // 3 Days
        'NMNP': 5,        // 5 Days
        'Existing': 0     // No Delay
    },
    VERIFICATION_DELAY: 3 // Activation + 3 Days
};

// --- HELPER: TIMEZONE FIX (IST) ---
// Ensures dates are always calculated in Indian Standard Time, even on Cloud Servers
function getISTDate(offsetMonths = 0) {
    const now = new Date();
    
    // Get current time in IST context
    const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);

    // Calculate Start & End of Month based on IST
    const start = new Date(istDate.getFullYear(), istDate.getMonth() - offsetMonths, 1);
    const end = new Date(istDate.getFullYear(), istDate.getMonth() - offsetMonths + 1, 1);
    
    // Reset hours to midnight
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    
    // Adjust to UTC: IST is UTC+5:30. 
    // To match 12:00 AM IST in database (UTC), we subtract 5 hours 30 mins.
    start.setMinutes(start.getMinutes() - 330); 
    end.setMinutes(end.getMinutes() - 330);

    return { start, end, now: new Date() };
}

// --- HELPER: CALCULATE RUNS ---
function getRuns(category, subType) {
    if (category === 'Family') {
        if (subType === 'MNP' || subType === 'NMNP') return 3; // Family MNP = 3 Runs
        return 1; // Family Fresh/P2P = 1 Run
    } else {
        if (subType === 'MNP' || subType === 'NMNP') return 2; // Normal MNP = 2 Runs
        return 1; // Normal Fresh/P2P = 1 Run
    }
}

// --- EMAIL TEMPLATE ---
const getEmailTemplate = (otp, type = 'Login') => {
    const formattedOtp = otp.toString().split('').join(' ');
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: sans-serif; }
            .webkit { max-width: 500px; background-color: #ffffff; margin: 0 auto; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; }
            .header { background-color: #4f46e5; padding: 30px; text-align: center; }
            .header h1 { margin: 0; color: #ffffff; font-size: 24px; }
            .content { padding: 30px; text-align: center; }
            .otp-box { background-color: #f8fafc; color: #4f46e5; font-size: 28px; font-weight: 700; padding: 15px 25px; border-radius: 12px; border: 2px dashed #cbd5e1; display: inline-block; }
            .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
        </style>
    </head>
    <body>
        <br><div class="webkit">
            <div class="header"><h1>VerifyHub</h1></div>
            <div class="content">
                <h3>${type} Verification</h3>
                <p>Use the code below to access your dashboard.</p>
                <div class="otp-box">${formattedOtp}</div>
                <p>⚠️ Secure your account immediately.</p>
            </div>
            <div class="footer">&copy; ${new Date().getFullYear()} VerifyHub Security.</div>
        </div><br>
    </body>
    </html>`;
};

// --- MIDDLEWARE ---
app.use(helmet({ contentSecurityPolicy: false }));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: "Too many login attempts." });
const otpLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: "Too many OTP attempts." });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- SESSION SETUP ---
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60, 
        autoRemove: 'native',
        touchAfter: 24 * 3600
    }),
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict' }
}));

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isLoggedIn) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return next();
    }
    if (req.xhr) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.redirect('/login');
};

// --- DB SCHEMA ---
const customerSchema = new mongoose.Schema({
    name: String, 
    mobile: String, 
    category: String, 
    subType: String, 
    region: { type: String, default: 'NA' }, 
    familyRole: { type: String, default: 'Secondary' }, 
    linkedPrimaryName: String, 
    linkedPrimaryNumber: String, 
    linkedPrimaryStatus: String, 
    remarks: { type: String, default: '' },
    status: { type: String, default: 'pending' }, 
    createdAt: { type: Date, default: Date.now }, 
    activationDate: Date, 
    verificationDate: Date 
});
const Customer = mongoose.model('Customer', customerSchema);

// --- DB CONNECTION ---
const connectDB = async () => {
    try { 
        await mongoose.connect(MONGO_URI, { 
            maxPoolSize: 10, minPoolSize: 2, socketTimeoutMS: 45000, serverSelectionTimeoutMS: 5000, family: 4              
        });
        console.log('✅ MongoDB Connected'); 
    } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); setTimeout(connectDB, 5000); }
};
connectDB();

// --- LOGIC CALCULATOR ---
function calculateLogic(baseDate, type) {
    const activationDelay = RULES.ACTIVATION_DELAY[type] !== undefined ? RULES.ACTIVATION_DELAY[type] : 0;
    const realActivationDate = new Date(baseDate);
    realActivationDate.setDate(realActivationDate.getDate() + activationDelay);
    realActivationDate.setHours(0,0,0,0);

    const realVerificationDate = new Date(realActivationDate);
    if (type !== 'Existing') {
        realVerificationDate.setDate(realVerificationDate.getDate() + RULES.VERIFICATION_DELAY);
    }
    realVerificationDate.setHours(0,0,0,0);
    return { realActivationDate, realVerificationDate };
}

// --- ROUTES ---
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/login', (req, res) => { 
    if (req.session.isLoggedIn) return res.redirect('/'); 
    res.render('login', { error: null }); 
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, Vpassword, remember } = req.body;
    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp; req.session.tempUser = { username, remember };
        try { 
            await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { 
                recipient: ADMIN_EMAIL_RECEIVER, 
                subject: '🔐 Login Code', 
                message: getEmailTemplate(otp, 'Login') 
            }); 
            res.redirect('/otp'); 
        } 
        catch (error) { res.render('login', { error: 'Email Service Error' }); }
    } else { res.render('login', { error: 'Invalid Credentials' }); }
});

app.get('/otp', (req, res) => { 
    if (!req.session.otp) return res.redirect('/login'); 
    res.render('otp', { error: null }); 
});

app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    if (req.session.otp && otp.replace(/\s/g, '') === req.session.otp) {
        req.session.isLoggedIn = true; 
        req.session.cookie.maxAge = (req.session.tempUser.remember === 'on') ? 365 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        delete req.session.otp; delete req.session.tempUser; res.redirect('/');
    } else { res.render('otp', { error: 'Invalid OTP' }); }
});

app.post('/resend-otp', async (req, res) => {
    if (!req.session.tempUser) return res.status(401).json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    try { 
        await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { 
            recipient: ADMIN_EMAIL_RECEIVER, 
            subject: '🔄 New Code', 
            message: getEmailTemplate(otp, 'Resend') 
        }); 
        res.json({ success: true }); 
    } 
    catch (error) { res.status(500).json({ success: false }); }
});

app.get('/logout', (req, res) => { 
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); }); 
});

// --- PAGES (NOW USING IST LOGIC) ---
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        // Use IST Date Calculation
        const { start, end, now } = getISTDate(monthOffset);
        
        // Adjust display month name to match IST
        const displayMonth = new Date(start);
        displayMonth.setMinutes(displayMonth.getMinutes() + 330);

        const query = { verificationDate: { $gte: start, $lt: end, $lte: new Date(now.getTime() + 24*60*60*1000) }, status: 'pending' };
        const headerTitle = "Pending: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        
        const customers = await Customer.find(query).sort({ verificationDate: 1 });
        res.render('index', { customers, error: null, page: 'home', monthOffset, headerTitle });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error" }); }
});

app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {}; let headerTitle = "All History";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        if (monthQuery !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { createdAt: { $gte: start, $lt: end } }; 
            
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "History: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear(); 
        }
        const customers = await Customer.find(query).sort({ createdAt: -1 });
        res.render('all', { customers, page: 'all', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

// --- ANALYTICS (IST FIXED + ACTIVATION BASED RUNS) ---
app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let entryQuery = {}; 
        let headerTitle = "All Time Analysis";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        // 1. Get Dates in IST
        const { start, end, now } = getISTDate(monthOffset);
        
        // 2. Logic for Entries (Show in Entry Month)
        if (req.query.month !== 'all') { 
            entryQuery = { createdAt: { $gte: start, $lt: end } }; 
            
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "Analysis: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear(); 
        }
        
        const monthlyEntries = await Customer.find(entryQuery).sort({ activationDate: 1 });
        
        // 3. Logic for Activations (For Runs & Activation Count)
        let activationQuery = {};
        if (req.query.month === 'all') {
            activationQuery = { activationDate: { $lte: now } };
        } else {
            activationQuery = { activationDate: { $gte: start, $lt: end } };
        }
        
        const monthlyActivations = await Customer.find(activationQuery);

        const stats = { 
            total: 0, 
            activated: monthlyActivations.length, // Count from activated list
            runs: 0, 
            nc: 0, p2p: 0, mnp: 0, nmnp: 0, family: 0, 
            completed: 0, pending: 0 
        };

        // LOOP 1: Calculate Entry Stats (Based on Entry Date)
        monthlyEntries.forEach(c => {
            stats.total++; 
            if (c.status === 'completed') stats.completed++; else stats.pending++;

            if (c.subType === 'NC') stats.nc++;
            else if (c.subType === 'P2P') stats.p2p++;
            else if (c.subType === 'MNP') stats.mnp++;
            else if (c.subType === 'NMNP') stats.nmnp++;
            
            if (c.category === 'Family') stats.family++;

            // Ghost Detection for Entry Count
            if (c.category === 'Family' && c.familyRole === 'Secondary') {
                const pStatus = c.linkedPrimaryStatus || '';
                if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                    const primaryDoc = monthlyEntries.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                    if (!primaryDoc) {
                        stats.total++;
                        stats.family++;
                        if (c.status === 'completed') stats.completed++; else stats.pending++;
                        if (pStatus.includes('NC')) stats.nc++;
                        else if (pStatus.includes('P2P')) stats.p2p++;
                        else if (pStatus.includes('MNP')) stats.mnp++;
                        else if (pStatus.includes('NMNP')) stats.nmnp++;
                    }
                }
            }
        });

        // LOOP 2: Calculate RUNS (Based on ACTIVATION Date)
        monthlyActivations.forEach(c => {
            // Add Run for this Activated SIM
            let currentRun = getRuns(c.category, c.subType);
            stats.runs += currentRun;

            // Ghost Detection for Runs (Virtual Run)
            if (c.category === 'Family' && c.familyRole === 'Secondary') {
                const pStatus = c.linkedPrimaryStatus || '';
                if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                    
                    const primaryDoc = monthlyActivations.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                    
                    // If Primary NOT found in activated list, it's a Ghost Run
                    if (!primaryDoc) {
                        let ghostType = 'NC'; 
                        if (pStatus.includes('MNP') || pStatus.includes('NMNP')) ghostType = 'MNP';
                        else if (pStatus.includes('P2P')) ghostType = 'P2P';
                        
                        let ghostRuns = getRuns('Family', ghostType); 
                        stats.runs += ghostRuns;
                    }
                }
            }
        });

        const pendingList = monthlyEntries.filter(c => c.activationDate && c.activationDate > now);
        res.render('analytics', { stats, pendingList, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {}; let headerTitle = "Managing All Records";
        if (monthQuery !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { createdAt: { $gte: start, $lt: end } }; 
        }
        const allCustomers = await Customer.find(query).sort({ createdAt: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { category, customDate, remarks, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile } = req.body;
        const entryDate = customDate ? new Date(customDate) : new Date();

        if (category === 'Family') {
            if (p_type !== 'Existing') {
                const pLogic = calculateLogic(entryDate, p_type);
                const primaryCustomer = new Customer({
                    name: p_name, mobile: p_mobile, category: 'Family', subType: p_type, region: 'NA',
                    familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: 'pending'
                });
                await primaryCustomer.save();
            }
            const sLogic = calculateLogic(entryDate, s_type);
            const secondaryCustomer = new Customer({
                name: s_name, mobile: s_mobile, category: 'Family', subType: s_type, region: 'NA',
                familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                remarks: remarks || '', createdAt: entryDate, activationDate: sLogic.realActivationDate, verificationDate: sLogic.realVerificationDate, status: 'pending'
            });
            await secondaryCustomer.save();
        } else {
            const nLogic = calculateLogic(entryDate, category);
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, category: category, subType: category, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: 'pending'
            });
            await newCustomer.save();
        }
        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { category, activationDate, remarks, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile } = req.body;
        const entryDate = new Date(activationDate);
        let updateData = { category, remarks };
        let finalSubType = category;

        if (category === 'Family') {
            updateData.name = s_name; updateData.mobile = s_mobile; updateData.subType = s_type; updateData.region = 'NA';
            updateData.familyRole = 'Secondary'; updateData.linkedPrimaryName = p_name; updateData.linkedPrimaryNumber = p_mobile; updateData.link

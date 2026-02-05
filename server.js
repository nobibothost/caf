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
   ==========================================================================
*/
const RULES = {
    ACTIVATION_DELAY: {
        'NC': 0,          // Instant Activation
        'P2P': 0,         // Instant Activation
        'MNP_Delhi': 3,   // 3 Days Delay
        'MNP_Other': 5,   // 5 Days Delay
        'Existing': 0     // Already Active
    },
    VERIFICATION_DELAY: 3
};

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
    subType: String, // Stores: NC, P2P, MNP, Existing
    region: String,  
    familyRole: { type: String, default: 'Secondary' }, // 'Primary' or 'Secondary'
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
mongoose.connection.on('connected', () => { console.log('🟢 Mongoose connected'); });
mongoose.connection.on('error', (err) => { console.log('🔴 Mongoose error:', err); });
mongoose.connection.on('disconnected', () => { console.log('🟠 Mongoose disconnected'); });
connectDB();

// --- LOGIC CALCULATOR ---
function calculateLogic(baseDate, type, region, primaryStatus = null) {
    let delay = 0;
    
    // 1. Primary Delay (Wait for Primary to be active)
    if (primaryStatus) {
        if (primaryStatus.includes('Existing')) delay += RULES.ACTIVATION_DELAY.Existing;
        else if (primaryStatus.includes('MNP') && primaryStatus.includes('Delhi')) delay += RULES.ACTIVATION_DELAY.MNP_Delhi;
        else if (primaryStatus.includes('MNP') && primaryStatus.includes('Other')) delay += RULES.ACTIVATION_DELAY.MNP_Other;
        else delay += RULES.ACTIVATION_DELAY.NC; // For New NC/P2P Primary
    }

    // 2. Own Delay (Secondary's own activation time)
    if (type === 'MNP') delay += (region === 'Delhi') ? RULES.ACTIVATION_DELAY.MNP_Delhi : RULES.ACTIVATION_DELAY.MNP_Other;
    else if (type === 'NC' || type === 'P2P') delay += RULES.ACTIVATION_DELAY.NC;
    else delay += RULES.ACTIVATION_DELAY.Existing;

    const realActivationDate = new Date(baseDate);
    realActivationDate.setDate(realActivationDate.getDate() + delay);
    realActivationDate.setHours(0,0,0,0);

    const realVerificationDate = new Date(realActivationDate);
    // Standard delay for verification after activation
    if (type !== 'Existing') realVerificationDate.setDate(realVerificationDate.getDate() + RULES.VERIFICATION_DELAY);
    realVerificationDate.setHours(0,0,0,0);

    return { realActivationDate, realVerificationDate };
}

// --- ROUTES ---
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/login', (req, res) => { if (req.session.isLoggedIn) return res.redirect('/'); res.render('login', { error: null }); });
app.post('/login', loginLimiter, async (req, res) => {
    const { username, Vpassword, remember } = req.body;
    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp; req.session.tempUser = { username, remember };
        try { await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: '🔐 Login Code', message: getEmailTemplate(otp, 'Login') }); res.redirect('/otp'); } 
        catch (error) { res.render('login', { error: 'Email Service Error' }); }
    } else { res.render('login', { error: 'Invalid Credentials' }); }
});
app.get('/otp', (req, res) => { if (!req.session.otp) return res.redirect('/login'); res.render('otp', { error: null }); });
app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    if (req.session.otp && otp.replace(/\s/g, '') === req.session.otp) {
        req.session.isLoggedIn = true; req.session.cookie.maxAge = (req.session.tempUser.remember === 'on') ? 365 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        delete req.session.otp; delete req.session.tempUser; res.redirect('/');
    } else { res.render('otp', { error: 'Invalid OTP' }); }
});
app.post('/resend-otp', async (req, res) => {
    if (!req.session.tempUser) return res.status(401).json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    try { await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: '🔄 New Code', message: getEmailTemplate(otp, 'Resend') }); res.json({ success: true }); } 
    catch (error) { res.status(500).json({ success: false }); }
});
app.get('/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); }); });

// --- PAGES ---
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const now = new Date(); const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1); const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
        const tomorrow = new Date(); tomorrow.setHours(23, 59, 59, 999);
        const query = { verificationDate: { $gte: startData, $lt: endData, $lte: tomorrow }, status: 'pending' };
        const headerTitle = "Pending: " + monthNames[startData.getMonth()] + " " + startData.getFullYear();
        const customers = await Customer.find(query).sort({ verificationDate: 1 });
        res.render('index', { customers, error: null, page: 'home', monthOffset, headerTitle });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error" }); }
});

app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {}; let headerTitle = "All History";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        if (monthQuery !== 'all') { const now = new Date(); const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1); const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1); query = { createdAt: { $gte: startData, $lt: endData } }; headerTitle = "History: " + monthNames[startData.getMonth()] + " " + startData.getFullYear(); }
        const customers = await Customer.find(query).sort({ createdAt: -1 });
        res.render('all', { customers, page: 'all', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {}; let headerTitle = "All Time Analysis";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const now = new Date(); const startOfMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1); const endOfMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
        
        if (req.query.month !== 'all') { query = { createdAt: { $gte: startOfMonth, $lt: endOfMonth } }; headerTitle = "Analysis: " + monthNames[startOfMonth.getMonth()] + " " + startOfMonth.getFullYear(); }
        
        const monthlyData = await Customer.find(query);
        
        let activatedCount = 0;
        // Count Actually Activated (Date Passed)
        if (req.query.month !== 'all') { 
            const actQuery = { activationDate: { $gte: startOfMonth, $lt: endOfMonth, $lte: now } }; 
            activatedCount = await Customer.countDocuments(actQuery); 
        } else { 
            activatedCount = await Customer.countDocuments({ activationDate: { $lte: now } }); 
        }

        const stats = { 
            total: monthlyData.length, // Counts every DB entry (Double Entry = 2 Sales)
            activated: activatedCount, 
            nc: monthlyData.filter(c => c.subType === 'NC').length,
            p2p: monthlyData.filter(c => c.subType === 'P2P').length,
            mnp: monthlyData.filter(c => c.subType === 'MNP').length,
            family: monthlyData.filter(c => c.category === 'Family').length,
            completed: monthlyData.filter(c => c.status === 'completed').length, 
            pending: monthlyData.filter(c => c.status === 'pending').length 
        };
        res.render('analytics', { stats, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {}; let headerTitle = "Managing All Records";
        if (monthQuery !== 'all') { const now = new Date(); const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1); const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1); query = { createdAt: { $gte: startData, $lt: endData } }; }
        const allCustomers = await Customer.find(query).sort({ createdAt: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

// --- ACTIONS (DOUBLE ENTRY LOGIC) ---
app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { category, customDate, remarks, p_type, p_name, p_mobile, p_region, s_type, s_name, s_mobile, s_region, n_name, n_mobile, n_region } = req.body;
        const entryDate = customDate ? new Date(customDate) : new Date();

        if (category === 'Family') {
            
            // 1. CREATE PRIMARY (Only if NOT Existing) -> This counts as 1 activation (Sale)
            if (p_type !== 'Existing') {
                // Force NA if not MNP
                const pRegionFinal = (p_type === 'MNP') ? (p_region || 'NA') : 'NA';
                const pLogic = calculateLogic(entryDate, p_type, pRegionFinal, null);
                
                const primaryCustomer = new Customer({
                    name: p_name,
                    mobile: p_mobile,
                    category: 'Family',
                    subType: p_type, // Stores: NC, P2P, MNP
                    region: pRegionFinal,
                    familyRole: 'Primary', // Mark as Primary
                    linkedPrimaryName: 'Self',
                    linkedPrimaryNumber: p_mobile,
                    linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '',
                    createdAt: entryDate,
                    activationDate: pLogic.realActivationDate,
                    verificationDate: pLogic.realVerificationDate,
                    status: 'pending'
                });
                await primaryCustomer.save();
            }

            // 2. CREATE SECONDARY (Always) -> This counts as 2nd activation (Sale)
            // Force NA if not MNP
            const sRegionFinal = (s_type === 'MNP') ? (s_region || 'NA') : 'NA';
            let primaryStatusRef = null;
            if (p_type === 'Existing') primaryStatusRef = 'Existing'; 
            else if (p_type === 'NC' || p_type === 'P2P') primaryStatusRef = 'NC'; 
            else if (p_type === 'MNP') primaryStatusRef = `MNP_${p_region}`;

            const sLogic = calculateLogic(entryDate, s_type, sRegionFinal, primaryStatusRef);
            
            const secondaryCustomer = new Customer({
                name: s_name,
                mobile: s_mobile,
                category: 'Family',
                subType: s_type, // Stores: NC, P2P, MNP, Existing
                region: sRegionFinal,
                familyRole: 'Secondary', // Mark as Secondary
                linkedPrimaryName: p_name,
                linkedPrimaryNumber: p_mobile,
                linkedPrimaryStatus: `Type: ${p_type}` + (p_type === 'MNP' ? ` (${p_region})` : ''),
                remarks: remarks || '',
                createdAt: entryDate,
                activationDate: sLogic.realActivationDate,
                verificationDate: sLogic.realVerificationDate,
                status: 'pending'
            });
            await secondaryCustomer.save();

        } else {
            // Normal Entry
            // Force NA if not MNP
            const nRegionFinal = (category === 'MNP') ? (n_region || 'NA') : 'NA';
            const nLogic = calculateLogic(entryDate, category, nRegionFinal, null);
            
            const newCustomer = new Customer({
                name: n_name,
                mobile: n_mobile,
                category: category,
                subType: category,
                region: nRegionFinal,
                familyRole: '',
                linkedPrimaryName: '',
                linkedPrimaryNumber: '',
                linkedPrimaryStatus: '',
                remarks: remarks || '',
                createdAt: entryDate,
                activationDate: nLogic.realActivationDate,
                verificationDate: nLogic.realVerificationDate,
                status: 'pending'
            });
            await newCustomer.save();
        }

        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

// --- EDIT ACTION (Updated for Family Fields) ---
app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { 
            category, activationDate, remarks,
            p_type, p_name, p_mobile, p_region, 
            s_type, s_name, s_mobile, s_region,
            n_name, n_mobile, n_region 
        } = req.body;

        const entryDate = new Date(activationDate);
        let updateData = { category, remarks };
        let finalSubType = category, finalRegion = 'NA', primaryStatusRef = null;

        if (category === 'Family') {
            // Family Data
            updateData.name = s_name; 
            updateData.mobile = s_mobile;
            updateData.subType = s_type;
            
            finalRegion = (s_type === 'MNP') ? (s_region || 'NA') : 'NA';
            updateData.region = finalRegion;
            
            updateData.familyRole = 'Secondary'; // Assume secondary for editing flow context
            updateData.linkedPrimaryName = p_name;
            updateData.linkedPrimaryNumber = p_mobile;
            updateData.linkedPrimaryStatus = `Type: ${p_type}` + (p_type === 'MNP' ? ` (${p_region})` : '');
            
            finalSubType = s_type;
            if (p_type === 'Existing') primaryStatusRef = 'Existing'; 
            else if (p_type === 'NC' || p_type === 'P2P') primaryStatusRef = 'NC'; 
            else if (p_type === 'MNP') primaryStatusRef = `MNP_${p_region}`;

        } else {
            // Normal Data
            updateData.name = n_name; 
            updateData.mobile = n_mobile;
            updateData.subType = category;
            
            finalRegion = (category === 'MNP') ? (n_region || 'NA') : 'NA';
            updateData.region = finalRegion;
            
            updateData.familyRole = ''; updateData.linkedPrimaryName = ''; updateData.linkedPrimaryNumber = ''; updateData.linkedPrimaryStatus = '';
            finalSubType = category;
        }

        const { realActivationDate, realVerificationDate } = calculateLogic(entryDate, finalSubType, finalRegion, primaryStatusRef);
        updateData.activationDate = realActivationDate;
        updateData.verificationDate = realVerificationDate;

        await Customer.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/manage');
    } catch (err) { res.redirect('/manage'); }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => { try { await Customer.findByIdAndDelete(req.params.id); res.redirect('/manage'); } catch (err) { res.redirect('/manage'); } });
app.post('/complete/:id', isAuthenticated, async (req, res) => { try { await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); res.redirect('back'); } catch (err) { res.redirect('/'); } });
app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000; const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    setInterval(async () => { try { await axios.get(`${TARGET_URL}/health`); console.log(`✅ Pinged ${TARGET_URL}`); } catch (err) { console.error(`❌ Ping Failed`); } }, PING_INTERVAL);
});

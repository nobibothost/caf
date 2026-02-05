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

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sessions', ttl: 14 * 24 * 60 * 60 }),
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

// --- DB SCHEMA (Updated for Linked Primary Name) ---
const customerSchema = new mongoose.Schema({
    name: String, 
    mobile: String, 
    category: String, // Family, NC, P2P, MNP
    
    // Core Logic Fields
    subType: String, // NC, P2P, MNP
    region: String,  // Delhi/Other
    
    // Family Specific
    familyRole: { type: String, default: 'Secondary' }, // Always Secondary when adding via Family Form
    linkedPrimaryName: String, // NEW: Store Primary Name
    linkedPrimaryNumber: String, 
    linkedPrimaryStatus: String, // e.g., 'New MNP Delhi'

    remarks: { type: String, default: '' },
    status: { type: String, default: 'pending' }, 
    createdAt: { type: Date, default: Date.now },
    activationDate: Date, 
    verificationDate: Date
});
const Customer = mongoose.model('Customer', customerSchema);

const connectDB = async () => {
    try { await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000, family: 4 }); console.log('✅ MongoDB Connected'); } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); }
};
connectDB();

// --- ROUTES ---

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/login', (req, res) => { if (req.session.isLoggedIn) return res.redirect('/'); res.render('login', { error: null }); });
app.post('/login', loginLimiter, async (req, res) => {
    const { username, Vpassword, remember } = req.body;
    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp;
        req.session.tempUser = { username, remember };
        try { await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: '🔐 Login Code', message: getEmailTemplate(otp, 'Login') }); res.redirect('/otp'); } 
        catch (error) { res.render('login', { error: 'Email Service Error' }); }
    } else { res.render('login', { error: 'Invalid Credentials' }); }
});
app.get('/otp', (req, res) => { if (!req.session.otp) return res.redirect('/login'); res.render('otp', { error: null }); });
app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    if (req.session.otp && otp.replace(/\s/g, '') === req.session.otp) {
        req.session.isLoggedIn = true;
        req.session.cookie.maxAge = (req.session.tempUser.remember === 'on') ? 365 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        delete req.session.otp; delete req.session.tempUser;
        res.redirect('/');
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

// --- MAIN LOGIC ---

const getMonthQuery = (req, field = 'verificationDate') => {
    const monthQuery = req.query.month;
    let monthOffset = (monthQuery === undefined) ? 0 : monthQuery;
    let query = {};
    let headerTitle = "";
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    if (monthOffset === 'all') {
        query = {};
        headerTitle = (field === 'verificationDate') ? "All Pending Tasks" : "All History";
    } else {
        monthOffset = parseInt(monthOffset);
        const now = new Date();
        const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
        query[field] = { $gte: startData, $lt: endData };
        headerTitle = ((field === 'verificationDate') ? "Pending: " : "History: ") + monthNames[startData.getMonth()] + " " + startData.getFullYear();
    }
    return { query, headerTitle, monthOffset };
};

app.get('/', isAuthenticated, async (req, res) => {
    try {
        const { query, headerTitle, monthOffset } = getMonthQuery(req, 'verificationDate');
        const tomorrow = new Date();
        tomorrow.setHours(0,0,0,0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        query.verificationDate = { $lt: tomorrow };
        query.status = 'pending';
        const customers = await Customer.find(query).sort({ verificationDate: 1 });
        res.render('index', { customers, error: null, page: 'home', monthOffset, headerTitle });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error" }); }
});

app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const { query, headerTitle, monthOffset } = getMonthQuery(req, 'activationDate');
        const allCustomers = await Customer.find(query).sort({ activationDate: -1 });
        res.render('all', { customers: allCustomers, page: 'all', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month;
        let monthOffset = (monthQuery === undefined) ? 0 : parseInt(monthQuery);
        let query = {};
        let headerTitle = "";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);

        if (req.query.month === 'all') {
            query = {}; 
            headerTitle = "All Time Analysis";
        } else {
            query = { activationDate: { $gte: startOfMonth, $lt: endOfMonth } };
            headerTitle = "Analysis: " + monthNames[startOfMonth.getMonth()] + " " + startOfMonth.getFullYear();
        }

        const monthlyData = await Customer.find(query);
        let activatedCount = 0;
        
        if (req.query.month !== 'all') {
            const verStart = new Date(startOfMonth);
            const verEnd = new Date(endOfMonth);
            verEnd.setDate(verEnd.getDate() + 5); 

            const candidates = await Customer.find({ verificationDate: { $gte: verStart, $lt: verEnd } });
            activatedCount = candidates.filter(c => {
                let activeDate = new Date(c.verificationDate);
                const timeDiff = c.verificationDate.getTime() - c.activationDate.getTime();
                const daysDiff = timeDiff / (1000 * 3600 * 24);
                if (daysDiff < 2) activeDate = c.activationDate;
                else activeDate.setDate(activeDate.getDate() - 3);
                return activeDate >= startOfMonth && activeDate < endOfMonth;
            }).length;
        } else {
            activatedCount = monthlyData.length;
        }

        const stats = {
            total: monthlyData.length,
            activated: activatedCount,
            nc: monthlyData.filter(c => c.category === 'NC').length,
            p2p: monthlyData.filter(c => c.category === 'P2P').length,
            mnp: monthlyData.filter(c => c.category === 'MNP').length,
            family: monthlyData.filter(c => c.category === 'Family').length,
            completed: monthlyData.filter(c => c.status === 'completed').length,
            pending: monthlyData.filter(c => c.status === 'pending').length
        };
        res.render('analytics', { stats, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const { query, headerTitle, monthOffset } = getMonthQuery(req, 'activationDate');
        const allCustomers = await Customer.find(query).sort({ activationDate: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

// --- UPDATED ADD LOGIC (FAMILY COMBINED) ---
app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { 
            category, customDate, remarks,
            // Family Fields
            p_type, p_name, p_mobile, p_region,
            s_type, s_name, s_mobile, s_region,
            // Normal Fields
            n_name, n_mobile, n_region
        } = req.body;

        const baseDate = customDate ? new Date(customDate) : new Date();
        const verificationDate = new Date(baseDate);
        
        let status = 'pending';
        let finalName = '', finalMobile = '', finalSubType = '', finalRegion = 'NA';
        let finalLinkedName = '', finalLinkedNumber = '', finalLinkedStatus = '';

        let totalDaysToAdd = 0;

        if (category === 'Family') {
            // We are adding the SECONDARY line, but calculation depends on PRIMARY
            finalName = s_name;
            finalMobile = s_mobile;
            finalSubType = s_type;
            
            // Link details
            finalLinkedName = p_name;
            finalLinkedNumber = p_mobile;
            finalLinkedStatus = `Type: ${p_type}`; 
            if (p_type === 'MNP') finalLinkedStatus += ` (${p_region})`;

            // 1. Primary Delay
            let primaryDelay = 0;
            if (p_type === 'NC') primaryDelay = 3; // Wait 3 days for NC primary
            if (p_type === 'MNP') {
                primaryDelay = (p_region === 'Delhi') ? 6 : 8; // Wait 6/8 days for MNP primary
            }
            if (p_type === 'Existing') primaryDelay = 0; // No wait

            // 2. Secondary Delay (Own Time)
            let secondaryDelay = 3; // Default
            if (s_type === 'MNP') {
                finalRegion = s_region;
                secondaryDelay = (s_region === 'Delhi') ? 6 : 8;
            } else {
                // NC/P2P
                secondaryDelay = 3;
            }

            totalDaysToAdd = primaryDelay + secondaryDelay;

        } else {
            // Normal
            finalName = n_name; finalMobile = n_mobile; finalSubType = category;
            if (category === 'MNP') {
                finalRegion = n_region;
                totalDaysToAdd = (n_region === 'Delhi') ? 6 : 8;
            } else {
                totalDaysToAdd = 3;
            }
        }

        verificationDate.setDate(verificationDate.getDate() + totalDaysToAdd);
        verificationDate.setHours(0, 0, 0, 0);

        const newCustomer = new Customer({
            name: finalName, mobile: finalMobile, category, subType: finalSubType, region: finalRegion,
            familyRole: (category === 'Family') ? 'Secondary' : '',
            linkedPrimaryName: finalLinkedName, linkedPrimaryNumber: finalLinkedNumber, linkedPrimaryStatus: finalLinkedStatus,
            remarks: remarks || '', activationDate: baseDate, verificationDate, status
        });

        await newCustomer.save();
        res.redirect('/');

    } catch (err) { res.redirect('/'); }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { name, mobile, category, region, remarks, activationDate } = req.body;
        // Simple recalculation for edit
        let daysToAdd = 3;
        if (category === 'MNP') daysToAdd = (region === 'Delhi') ? 6 : 8;
        
        const newActivation = new Date(activationDate);
        const newVerification = new Date(newActivation);
        newVerification.setDate(newVerification.getDate() + daysToAdd);
        newVerification.setHours(0,0,0,0);

        await Customer.findByIdAndUpdate(req.params.id, {
            name, mobile, category, region, remarks,
            activationDate: newActivation, verificationDate: newVerification
        });
        res.redirect('/manage');
    } catch (err) { res.redirect('/manage'); }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
    try { await Customer.findByIdAndDelete(req.params.id); res.redirect('/manage'); } catch (err) { res.redirect('/manage'); }
});
app.post('/complete/:id', isAuthenticated, async (req, res) => {
    try { await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); res.redirect('back'); } catch (err) { res.redirect('/'); }
});
app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000;
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
        try { await axios.get(`${TARGET_URL}/health`); console.log(`✅ Pinged ${TARGET_URL}`); } 
        catch (err) { console.error(`❌ Ping Failed`); }
    }, PING_INTERVAL);
});

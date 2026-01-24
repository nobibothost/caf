require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const axios = require('axios'); // API calls ke liye

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Email website ka URL jahan request bhejni hai
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000'; 
// Jis email par OTP receive karna hai (Admin Email)
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com'; 
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';

// --- MIDDLEWARE ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session Setup
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000 // Default: 24 hours
    }
}));

// --- AUTH MIDDLEWARE ---
const isAuthenticated = (req, res, next) => {
    if (req.session.isLoggedIn) {
        return next();
    }
    res.redirect('/login');
};

// --- DATABASE SCHEMA ---
const customerSchema = new mongoose.Schema({
    name: String,
    mobile: String,
    category: String, // NC, P2P, MNP
    region: String,   // Delhi / Other
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    activationDate: Date,
    verificationDate: Date
});
const Customer = mongoose.model('Customer', customerSchema);

// --- DATABASE CONNECTION ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            family: 4
        });
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
};
connectDB();

// --- AUTH ROUTES ---

// 1. LOGIN PAGE
app.get('/login', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/');
    res.render('login', { error: null });
});

// 2. PROCESS LOGIN & CALL EMAIL API
app.post('/login', async (req, res) => {
    const { username, Vpassword, remember } = req.body;

    // Check Credentials
    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Save to session temporarily
        req.session.otp = otp;
        req.session.tempUser = { username, remember };

        console.log(`🔐 OTP Generated: ${otp}`);

        // --- CALL EXTERNAL EMAIL SERVICE ---
        try {
            // Email Website (Port 5000) ko request bhejo
            await axios.post(`${EMAIL_SERVICE_URL}/send-email`, {
                recipient: ADMIN_EMAIL_RECEIVER,
                subject: '🔐 Your Login OTP',
                message: `Hello Admin, Your login OTP is: ${otp}. Valid for this session.`
            });

            console.log('✅ API Call Success: OTP request sent to Email Service');
            res.redirect('/otp');

        } catch (error) {
            console.error('❌ Email Service API Error:', error.message);
            // Agar Email service down hai, toh error dikhao
            res.render('login', { error: 'Email Service Unreachable. Is port 5000 running?' });
        }

    } else {
        res.render('login', { error: 'Invalid Username or Password' });
    }
});

// 3. OTP PAGE
app.get('/otp', (req, res) => {
    if (!req.session.otp) return res.redirect('/login');
    res.render('otp', { error: null });
});

// 4. VERIFY OTP
app.post('/verify-otp', (req, res) => {
    const { otp } = req.body;

    if (req.session.otp && otp === req.session.otp) {
        // Login Success
        req.session.isLoggedIn = true;
        
        // Handle "Remember Me"
        const remember = req.session.tempUser.remember;
        if (remember === 'on') {
            req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000; // 1 Year
        } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 Hours
        }

        // Cleanup
        delete req.session.otp;
        delete req.session.tempUser;

        res.redirect('/');
    } else {
        res.render('otp', { error: 'Invalid OTP. Try again.' });
    }
});

// 5. LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});


// --- PROTECTED ROUTES (Requires Login) ---

app.get('/', isAuthenticated, async (req, res) => {
    try {
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const customers = await Customer.find({
            verificationDate: { $lt: tomorrow },
            status: 'pending'
        }).sort({ verificationDate: 1 });

        res.render('index', { customers, error: null, page: 'home' });
    } catch (err) {
        res.render('index', { customers: [], error: "Connection Error", page: 'home' });
    }
});

app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 });
        res.render('all', { customers: allCustomers, page: 'all' });
    } catch (err) {
        res.redirect('/');
    }
});

app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const monthlyData = await Customer.find({
            activationDate: { $gte: startOfMonth, $lte: endOfMonth }
        });

        const stats = {
            total: monthlyData.length,
            nc: monthlyData.filter(c => c.category === 'NC').length,
            p2p: monthlyData.filter(c => c.category === 'P2P').length,
            mnp: monthlyData.filter(c => c.category === 'MNP').length,
            completed: monthlyData.filter(c => c.status === 'completed').length,
            pending: monthlyData.filter(c => c.status === 'pending').length
        };

        res.render('analytics', { stats, page: 'analytics' });
    } catch (err) {
        res.redirect('/');
    }
});

app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage' });
    } catch (err) {
        res.redirect('/');
    }
});

app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { name, mobile, category, region, customDate } = req.body;
        
        let daysToAdd = 3; 
        if (category === 'MNP') {
            if (region === 'Delhi') { daysToAdd = 6; } else { daysToAdd = 8; }
        }

        const baseDate = customDate ? new Date(customDate) : new Date();
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);

        const newCustomer = new Customer({
            name, mobile, category,
            region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate,
            verificationDate,
            status: 'pending'
        });

        await newCustomer.save();
        res.redirect('/');
    } catch (err) {
        res.redirect('/');
    }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { name, mobile, category, region, activationDate } = req.body;
        
        let daysToAdd = 3; 
        if (category === 'MNP') {
            if (region === 'Delhi') { daysToAdd = 6; } else { daysToAdd = 8; }
        }

        const baseDate = new Date(activationDate);
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);

        await Customer.findByIdAndUpdate(req.params.id, {
            name, mobile, category,
            region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate,
            verificationDate
        });

        res.redirect('/manage');
    } catch (err) {
        res.redirect('/manage');
    }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await Customer.findByIdAndDelete(req.params.id);
        res.redirect('/manage');
    } catch (err) {
        res.redirect('/manage');
    }
});

app.post('/complete/:id', isAuthenticated, async (req, res) => {
    try {
        await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' });
        res.redirect('back');
    } catch (err) {
        res.redirect('/');
    }
});

app.get('*', (req, res) => {
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`🚀 Verification Server running on http://localhost:${PORT}`);
    if(!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
        console.log('⚠️ Warning: .env variables for Login are missing!');
    }
});

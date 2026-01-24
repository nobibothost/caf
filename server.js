require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- DATABASE SCHEMA ---
const customerSchema = new mongoose.Schema({
    name: String,
    mobile: String,
    category: String, // NC, P2P, MNP
    region: String,   // Delhi / Other
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    activationDate: Date, // User selected date
    verificationDate: Date // System calculated reminder date
});

const Customer = mongoose.model('Customer', customerSchema);

// --- DATABASE CONNECTION ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            family: 4 // Force IPv4 for stable mobile connection
        });
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
};
connectDB();

// --- ROUTES ---

// 1. HOME PAGE (Due Reminders - Pending & Due Today/Past)
app.get('/', async (req, res) => {
    try {
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Show pending items where Verification Date is < Tomorrow
        const customers = await Customer.find({
            verificationDate: { $lt: tomorrow },
            status: 'pending'
        }).sort({ verificationDate: 1 });

        // Pass 'page' variable for Nav highlighting
        res.render('index', { customers, error: null, page: 'home' });
    } catch (err) {
        res.render('index', { customers: [], error: "Connection Error", page: 'home' });
    }
});

// 2. ALL RECORDS (History)
app.get('/all', async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 }); // Newest first
        res.render('all', { customers: allCustomers, page: 'all' });
    } catch (err) {
        res.redirect('/');
    }
});

// 3. ANALYTICS PAGE (Monthly Stats)
app.get('/analytics', async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // Filter data for Current Month
        const monthlyData = await Customer.find({
            activationDate: {
                $gte: startOfMonth,
                $lte: endOfMonth
            }
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
        console.log(err);
        res.redirect('/');
    }
});

// 4. MANAGE PAGE (Edit & Search List)
app.get('/manage', async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage' });
    } catch (err) {
        res.redirect('/');
    }
});

// 5. ADD DATA ROUTE
app.post('/add', async (req, res) => {
    try {
        const { name, mobile, category, region, customDate } = req.body;
        
        // Logic: Calculate Days
        let daysToAdd = 3; // Default for NC/P2P
        if (category === 'MNP') {
            if (region === 'Delhi') {
                daysToAdd = 6; 
            } else {
                daysToAdd = 8; 
            }
        }

        const baseDate = customDate ? new Date(customDate) : new Date();
        
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);

        const newCustomer = new Customer({
            name,
            mobile,
            category,
            region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate,
            verificationDate,
            status: 'pending'
        });

        await newCustomer.save();
        res.redirect('/');
    } catch (err) {
        console.log("Save Error:", err);
        res.redirect('/');
    }
});

// 6. EDIT DATA ROUTE
app.post('/edit/:id', async (req, res) => {
    try {
        const { name, mobile, category, region, activationDate } = req.body;
        
        // Recalculate Verification Date
        let daysToAdd = 3; 
        if (category === 'MNP') {
            if (region === 'Delhi') {
                daysToAdd = 6; 
            } else {
                daysToAdd = 8; 
            }
        }

        const baseDate = new Date(activationDate);
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);

        await Customer.findByIdAndUpdate(req.params.id, {
            name,
            mobile,
            category,
            region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate,
            verificationDate
        });

        res.redirect('/manage');
    } catch (err) {
        console.log(err);
        res.redirect('/manage');
    }
});

// 7. DELETE DATA ROUTE
app.post('/delete/:id', async (req, res) => {
    try {
        await Customer.findByIdAndDelete(req.params.id);
        console.log("Deleted Record:", req.params.id);
        res.redirect('/manage');
    } catch (err) {
        console.log("Delete Error:", err);
        res.redirect('/manage');
    }
});

// 8. MARK COMPLETE ROUTE
app.post('/complete/:id', async (req, res) => {
    try {
        await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' });
        res.redirect('back'); // Reloads current page
    } catch (err) {
        res.redirect('/');
    }
});

// 9. CATCH-ALL (Redirect 404 to Home)
app.get('*', (req, res) => {
    res.redirect('/');
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});


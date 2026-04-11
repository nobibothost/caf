const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const {
    getISTDate, parseISTDateString, getRuns, getPayout,
    calculateLogic, fetchGroupedCustomers, safeRedirect
} = require('../utils/helpers');

const ITEMS_PER_PAGE = 10;

router.get('/', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        let query = { status: 'pending' };
        let headerTitle = "All Pending";

        if (monthOffset === 'all') {
            const { now } = getISTDate(0);
            query.verificationDate = { $lte: new Date(now.getTime() + 24*60*60*1000) };
        } else {
            const { start, end, now } = getISTDate(monthOffset);
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            
            if (monthOffset === 0) {
                query.verificationDate = { $gte: start, $lte: new Date(now.getTime() + 24*60*60*1000) };
            } else {
                query.verificationDate = { $gte: start, $lt: end };
            }
            headerTitle = "Pending: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        }
        
        const fullCustomers = await fetchGroupedCustomers(query, { verificationDate: 1 });
        
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('index', { customers: paginatedCustomers, error: null, page: 'home', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error", currentPage: 1, totalPages: 1 }); }
});

router.get('/all', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let query = {}; let headerTitle = "All History";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { 
                $or: [
                    { createdAt: { $gte: start, $lt: end } },
                    { activationDate: { $gte: start, $lt: end } }
                ] 
            }; 
            
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "History: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear(); 
        }
        const fullCustomers = await fetchGroupedCustomers(query, { activationDate: -1 });

        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('all', { customers: paginatedCustomers, page: 'all', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

router.get('/pdd', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const customers = await fetchGroupedCustomers({ billDate: { $ne: null } }, { billDate: 1 });
        
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();

        let pendingBills = [];

        customers.forEach(c => {
            let billYear = currentYear;
            let billMonth = currentMonth;

            if (currentDay <= c.billDate) {
                billMonth -= 1;
                if (billMonth < 0) {
                    billMonth = 11;
                    billYear -= 1;
                }
            }

            const dynamicLogic = calculateLogic(c.createdAt, c.subType || c.category);
            const actDate = dynamicLogic.realActivationDate;
            
            const actIst = new Date(actDate.getTime() + (330 * 60000));
            const actYear = actIst.getUTCFullYear();
            const actMonth = actIst.getUTCMonth();
            const actDay = actIst.getUTCDate();

            const calcBillVal = billYear * 10000 + billMonth * 100 + c.billDate;
            const actVal = actYear * 10000 + actMonth * 100 + actDay;

            if (calcBillVal >= actVal) {
                const cycleKey = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;

                if (!c.paidMonths || !c.paidMonths.includes(cycleKey)) {
                    pendingBills.push({ ...c, cycleKey });
                }
            }
        });

        const totalPages = Math.ceil(pendingBills.length / ITEMS_PER_PAGE);
        const paginatedBills = pendingBills.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('pdd', { pendingBills: paginatedBills, page: 'pdd', headerTitle: "PDD Tracking", currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

router.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        let headerTitle = "All Time Analysis";

        const { start, end, now } = getISTDate(monthOffset === 'all' ? 0 : monthOffset);

        if (monthOffset !== 'all') {
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "Analysis: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        }

        const allCustomers = await Customer.find().lean();

        const stats = { 
            total: 0, activated: 0, runs: 0, revenue: 0,
            nc: 0, p2p: 0, mnp: 0, nmnp: 0, family: 0, 
            completed: 0, pending: 0,
            carry_activated: 0, carry_nc: 0, carry_p2p: 0, carry_mnp: 0, carry_nmnp: 0, carry_family: 0, carry_revenue: 0
        };

        const pendingListRaw = [];

        allCustomers.forEach(c => {
            const cEntry = new Date(c.createdAt);
            
            // FIX: Use the actual saved activation date from DB, which correctly inherits the maximum delay (Primary vs Secondary).
            let cAct = new Date(c.activationDate || c.createdAt); 

            let isEntryThisMonth = false;
            let isActThisMonth = false;

            if (monthOffset === 'all') {
                isEntryThisMonth = true;
                isActThisMonth = true;
            } else {
                if (cEntry >= start && cEntry < end) isEntryThisMonth = true;
                if (cAct >= start && cAct < end) isActThisMonth = true;
            }

            if (isEntryThisMonth) {
                stats.total++;
                if (c.category === 'Family' && c.familyRole === 'Secondary') {
                    const pStatus = c.linkedPrimaryStatus || '';
                    if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                        const primaryDoc = allCustomers.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                        if (!primaryDoc) stats.total++; 
                    }
                }
            }

            if (isActThisMonth) {
                let isCarry = false;
                if (monthOffset !== 'all') {
                    isCarry = (cEntry < start);
                }

                if (c.subType === 'NC') { stats.nc++; if (isCarry) stats.carry_nc++; }
                else if (c.subType === 'P2P') { stats.p2p++; if (isCarry) stats.carry_p2p++; }
                else if (c.subType === 'MNP') { stats.mnp++; if (isCarry) stats.carry_mnp++; }
                else if (c.subType === 'NMNP') { stats.nmnp++; if (isCarry) stats.carry_nmnp++; }
                
                if (c.category === 'Family') { stats.family++; if (isCarry) stats.carry_family++; }

                let isActuallyActivated = (cAct <= now) || (c.status === 'completed');
                
                if (isActuallyActivated) {
                    stats.activated++;
                    if (isCarry) stats.carry_activated++;
                    
                    let earned = getPayout(c.category, c.subType, c.plan);
                    stats.revenue += earned;
                    if (isCarry) stats.carry_revenue += earned;
                }

                stats.runs += getRuns(c.category, c.subType);
                if (c.status === 'completed') stats.completed++; else stats.pending++;

                if (c.category === 'Family' && c.familyRole === 'Secondary') {
                    const pStatus = c.linkedPrimaryStatus || '';
                    if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                        const primaryDoc = allCustomers.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                        if (!primaryDoc) {
                            let ghostType = 'NC'; 
                            if (pStatus.includes('NMNP')) ghostType = 'NMNP'; 
                            else if (pStatus.includes('MNP')) ghostType = 'MNP';
                            else if (pStatus.includes('P2P')) ghostType = 'P2P';

                            if (isActuallyActivated) {
                                stats.activated++;
                                if (isCarry) stats.carry_activated++;
                                
                                let ghostEarned = getPayout('Family', ghostType, c.plan);
                                stats.revenue += ghostEarned;
                                if (isCarry) stats.carry_revenue += ghostEarned;
                            }
                            
                            stats.runs += getRuns('Family', ghostType); 
                            stats.family++;
                            if (isCarry) stats.carry_family++;
                            
                            if (c.status === 'completed') stats.completed++; else stats.pending++;

                            if (ghostType === 'NC') { stats.nc++; if (isCarry) stats.carry_nc++; }
                            else if (ghostType === 'P2P') { stats.p2p++; if (isCarry) stats.carry_p2p++; }
                            else if (ghostType === 'MNP') { stats.mnp++; if (isCarry) stats.carry_mnp++; }
                            else if (ghostType === 'NMNP') { stats.nmnp++; if (isCarry) stats.carry_nmnp++; }
                        }
                    }
                }
            }

            if (c.status === 'pending' && cAct > now) {
                if (monthOffset === 'all' || isActThisMonth) {
                    c.dynamicActDate = cAct;
                    pendingListRaw.push(c);
                }
            }
        });

        const pendingList = pendingListRaw
            .filter(c => !(c.category === 'Family' && c.familyRole === 'Primary'))
            .sort((a, b) => a.dynamicActDate - b.dynamicActDate);

        res.render('analytics', { stats, pendingList, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

router.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let query = {}; let headerTitle = "Managing All Records";
        
        if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { 
                $or: [
                    { createdAt: { $gte: start, $lt: end } },
                    { activationDate: { $gte: start, $lt: end } }
                ] 
            }; 
        }
        const fullCustomers = await fetchGroupedCustomers(query, { activationDate: -1 });

        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('manage', { customers: paginatedCustomers, page: 'manage', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

router.get('/search', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const q = req.query.q ? req.query.q.trim() : '';
        let fullCustomers = [];
        
        if (q) {
            const regex = new RegExp(q, 'i');
            const query = {
                $or: [
                    { name: regex },
                    { mobile: regex },
                    { linkedPrimaryNumber: regex },
                    { linkedPrimaryName: regex }
                ]
            };
            fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });
        }
        
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('search', { customers: paginatedCustomers, query: q, page: 'search', headerTitle: "Global Search", currentPage: page, totalPages, totalItems: fullCustomers.length });
    } catch (err) {
        res.redirect('/');
    }
});

router.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { category, customDate, remarks, plan, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile, billDate } = req.body;
        const entryDate = parseISTDateString(customDate);
        const bDate = billDate ? parseInt(billDate) : null;

        if (category === 'Family') {
            const sLogic = calculateLogic(entryDate, s_type);
            const pLogic = calculateLogic(entryDate, p_type);
            
            let finalActDate = sLogic.realActivationDate;
            let finalVerDate = sLogic.realVerificationDate;

            // Inherit the maximum delay across the family connections
            if (pLogic.realVerificationDate > finalVerDate) {
                finalActDate = pLogic.realActivationDate;
                finalVerDate = pLogic.realVerificationDate;
            }

            if (p_type !== 'Existing') {
                const primaryCustomer = new Customer({
                    name: p_name, mobile: p_mobile, category: 'Family', subType: p_type, plan: plan, region: 'NA',
                    familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: 'pending', billDate: bDate
                });
                await primaryCustomer.save();
            }

            const secondaryCustomer = new Customer({
                name: s_name, mobile: s_mobile, category: 'Family', subType: s_type, plan: plan, region: 'NA',
                familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                remarks: remarks || '', createdAt: entryDate, activationDate: finalActDate, verificationDate: finalVerDate, status: 'pending', billDate: bDate
            });
            await secondaryCustomer.save();
        } else {
            const nLogic = calculateLogic(entryDate, category);
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, category: category, subType: category, plan: plan, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: 'pending', billDate: bDate
            });
            await newCustomer.save();
        }
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

router.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { category, activationDate, remarks, plan, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile, billDate } = req.body;
        
        const newEntryDate = parseISTDateString(activationDate);
        const bDate = billDate ? parseInt(billDate) : null;

        const existingDoc = await Customer.findById(req.params.id);

        if (existingDoc && existingDoc.category === 'Family' && existingDoc.familyRole === 'Secondary') {
            const oldPrimaryMobile = existingDoc.linkedPrimaryNumber;
            const pLogic = calculateLogic(newEntryDate, p_type);
            
            // Keep primary document in sync if it exists
            await Customer.findOneAndUpdate(
                 { category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile },
                 { name: p_name, mobile: p_mobile, subType: p_type, plan: plan, createdAt: newEntryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, billDate: bDate }
            );
        }

        let updateData = { category, remarks, plan, billDate: bDate };
        let finalSubType = category;

        if (category === 'Family') {
            updateData.name = s_name; updateData.mobile = s_mobile; updateData.subType = s_type; updateData.region = 'NA';
            updateData.familyRole = 'Secondary'; updateData.linkedPrimaryName = p_name; updateData.linkedPrimaryNumber = p_mobile; updateData.linkedPrimaryStatus = `Type: ${p_type}`;
            finalSubType = s_type;
        } else {
            updateData.name = n_name; updateData.mobile = n_mobile; updateData.subType = category; updateData.region = 'NA';
            updateData.familyRole = '';
            updateData.linkedPrimaryName = ''; updateData.linkedPrimaryNumber = ''; updateData.linkedPrimaryStatus = '';
            finalSubType = category;
        }

        const sLogic = calculateLogic(newEntryDate, finalSubType);
        let finalActDate = sLogic.realActivationDate;
        let finalVerDate = sLogic.realVerificationDate;

        if (category === 'Family') {
             const pLogic = calculateLogic(newEntryDate, p_type);
             // Override with maximum delay exactly like the add route
             if (pLogic.realVerificationDate > finalVerDate) {
                 finalActDate = pLogic.realActivationDate;
                 finalVerDate = pLogic.realVerificationDate;
             }
        }

        updateData.createdAt = newEntryDate; 
        updateData.activationDate = finalActDate; 
        updateData.verificationDate = finalVerDate; 

        await Customer.findByIdAndUpdate(req.params.id, updateData);
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

router.post('/delete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
            await Customer.findOneAndDelete({ category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber });
        }
        await Customer.findByIdAndDelete(req.params.id); 
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

router.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if (doc) {
            await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' });
            if (doc.category === 'Family' && doc.familyRole === 'Secondary') {
                await Customer.findOneAndUpdate(
                    { category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber },
                    { status: 'completed' }
                );
            }
        }
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

router.post('/pay-bill/:id', isAuthenticated, async (req, res) => {
    try {
        const { cycleKey } = req.body;
        if(cycleKey) {
            const doc = await Customer.findById(req.params.id);
            if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
                await Customer.findOneAndUpdate(
                    { category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber }, 
                    { $addToSet: { paidMonths: cycleKey }}
                );
            }
            await Customer.findByIdAndUpdate(req.params.id, {
                $addToSet: { paidMonths: cycleKey }
            });
        }
        safeRedirect(req, res);
    } catch(err) { safeRedirect(req, res); }
});

router.post('/pay-all-bills', isAuthenticated, async (req, res) => {
    try {
        const customers = await Customer.find({ billDate: { $ne: null } });
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();
        const bulkOps = [];

        customers.forEach(c => {
            let billYear = currentYear;
            let billMonth = currentMonth;
            if (currentDay <= c.billDate) {
                billMonth -= 1;
                if (billMonth < 0) { billMonth = 11; billYear -= 1; }
            }

            const dynamicLogic = calculateLogic(c.createdAt, c.subType || c.category);
            const actDate = dynamicLogic.realActivationDate;
            const actIst = new Date(actDate.getTime() + (330 * 60000));
            const actYear = actIst.getUTCFullYear();
            const actMonth = actIst.getUTCMonth();
            const actDay = actIst.getUTCDate();

            const calcBillVal = billYear * 10000 + billMonth * 100 + c.billDate;
            const actVal = actYear * 10000 + actMonth * 100 + actDay;

            if (calcBillVal >= actVal) {
                const cycleKey = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;
                if (!c.paidMonths || !c.paidMonths.includes(cycleKey)) {
                    bulkOps.push({
                        updateOne: { filter: { _id: c._id }, update: { $addToSet: { paidMonths: cycleKey } } }
                    });
                    if (c.category === 'Family' && c.familyRole === 'Secondary') {
                        bulkOps.push({
                            updateOne: { filter: { category: 'Family', familyRole: 'Primary', mobile: c.linkedPrimaryNumber }, update: { $addToSet: { paidMonths: cycleKey } } }
                        });
                    }
                }
            }
        });

        if (bulkOps.length > 0) { await Customer.bulkWrite(bulkOps); }
        safeRedirect(req, res);
    } catch(err) { safeRedirect(req, res); }
});

router.post('/log-call/:id', isAuthenticated, async (req, res) => {
    try {
        const { pageType, reason, notes } = req.body;
        await Customer.findByIdAndUpdate(req.params.id, {
            $push: {
                callLogs: { callDate: new Date(), pageType, reason, notes }
            }
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
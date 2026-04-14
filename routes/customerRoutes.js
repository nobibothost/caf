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
    } catch (err) { 
        console.error('Home Route Error:', err);
        res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error", currentPage: 1, totalPages: 1 }); 
    }
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
    } catch (err) { 
        console.error('All History Route Error:', err);
        res.redirect('/'); 
    }
});

router.get('/pdd', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const customers = await Customer.find({ billDate: { $ne: null } }).lean();
        
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
        
        pendingBills.sort((a, b) => a.billDate - b.billDate);

        const totalPages = Math.ceil(pendingBills.length / ITEMS_PER_PAGE);
        const paginatedBills = pendingBills.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('pdd', { pendingBills: paginatedBills, page: 'pdd', headerTitle: "PDD Tracking", currentPage: page, totalPages });
    } catch (err) { 
        console.error('PDD Route Error:', err);
        res.redirect('/'); 
    }
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
    } catch (err) { 
        console.error('Analytics Route Error:', err);
        res.redirect('/'); 
    }
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
    } catch (err) { 
        console.error('Manage Route Error:', err);
        res.redirect('/'); 
    }
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
        console.error('Search Route Error:', err);
        res.redirect('/');
    }
});

router.post('/add', isAuthenticated, async (req, res) => {
    try {
        const getFirst = (val) => Array.isArray(val) ? val[0] : (val || '');
        
        const category = getFirst(req.body.category);
        const rawDate = getFirst(req.body.customDate) || getFirst(req.body.activationDate) || getFirst(req.body.editDate);
        const remarks = getFirst(req.body.remarks);
        const plan = getFirst(req.body.plan);
        const billDateStr = getFirst(req.body.billDate);

        const entryDate = parseISTDateString(rawDate);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (category === 'Family') {
            const p_type = getFirst(req.body.p_type) || 'NC';
            const p_name = getFirst(req.body.p_name);
            const p_mobile = getFirst(req.body.p_mobile);

            const pLogic = calculateLogic(entryDate, p_type);

            // Primary Creation
            if (p_type !== 'Existing') {
                const primaryCustomer = new Customer({
                    name: p_name, mobile: p_mobile, category: 'Family', subType: p_type, plan: plan, region: 'NA',
                    familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: 'pending', billDate: bDate
                });
                await primaryCustomer.save();
            }

            // Secondary Creation (Safely handling Arrays from UI)
            const s_types = Array.isArray(req.body.s_type) ? req.body.s_type : [req.body.s_type];
            const s_names = Array.isArray(req.body.s_name) ? req.body.s_name : [req.body.s_name];
            const s_mobiles = Array.isArray(req.body.s_mobile) ? req.body.s_mobile : [req.body.s_mobile];

            for (let i = 0; i < s_names.length; i++) {
                if (!s_names[i] || s_names[i].trim() === '') continue; 
                
                const sType = s_types[i] || 'NC';
                const sName = s_names[i];
                const sMobile = s_mobiles[i];

                const sLogic = calculateLogic(entryDate, sType);
                let finalActDate = sLogic.realActivationDate;
                let finalVerDate = sLogic.realVerificationDate;

                if (pLogic.realVerificationDate > finalVerDate) {
                    finalActDate = pLogic.realActivationDate;
                    finalVerDate = pLogic.realVerificationDate;
                }

                const secondaryCustomer = new Customer({
                    name: sName, mobile: sMobile, category: 'Family', subType: sType, plan: plan, region: 'NA',
                    familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                    remarks: remarks || '', createdAt: entryDate, activationDate: finalActDate, verificationDate: finalVerDate, status: 'pending', billDate: bDate
                });
                await secondaryCustomer.save();
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = getFirst(req.body.n_mobile);
            
            const nLogic = calculateLogic(entryDate, category);
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, category: category, subType: category, plan: plan, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: 'pending', billDate: bDate
            });
            await newCustomer.save();
        }
        safeRedirect(req, res);
    } catch (err) { 
        console.error('Add Route Error:', err);
        safeRedirect(req, res); 
    }
});

router.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        // Prevent crashes by ensuring we get single strings even if form passes arrays
        const getFirst = (val) => Array.isArray(val) ? val[0] : (val || '');
        
        const category = getFirst(req.body.category);
        const rawDate = getFirst(req.body.activationDate) || getFirst(req.body.customDate) || getFirst(req.body.editDate);
        const remarks = getFirst(req.body.remarks);
        const plan = getFirst(req.body.plan);
        const p_type = getFirst(req.body.p_type);
        const p_name = getFirst(req.body.p_name);
        const p_mobile = getFirst(req.body.p_mobile);
        const s_type = getFirst(req.body.s_type);
        const s_name = getFirst(req.body.s_name);
        const s_mobile = getFirst(req.body.s_mobile);
        const n_name = getFirst(req.body.n_name);
        const n_mobile = getFirst(req.body.n_mobile);
        const billDateStr = getFirst(req.body.billDate);

        const existingDoc = await Customer.findById(req.params.id);
        if (!existingDoc) return safeRedirect(req, res);

        const newEntryDate = parseISTDateString(rawDate, existingDoc.createdAt);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (existingDoc.category === 'Family' && existingDoc.familyRole === 'Secondary') {
            const oldPrimaryMobile = existingDoc.linkedPrimaryNumber;
            const pLogic = calculateLogic(newEntryDate, p_type);
            
            await Customer.findOneAndUpdate(
                 { category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile },
                 { name: p_name, mobile: p_mobile, subType: p_type, plan: plan, createdAt: newEntryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, billDate: bDate }
            );

            // Bulk update any OTHER secondaries linked to this primary to reflect new Primary Details
            await Customer.updateMany(
                { category: 'Family', familyRole: 'Secondary', linkedPrimaryNumber: oldPrimaryMobile, _id: { $ne: req.params.id } },
                { linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, plan: plan }
            );
        }

        let updateData = { category, remarks, plan, billDate: bDate };
        let finalSubType = category;

        if (category === 'Family') {
            updateData.name = s_name; 
            updateData.mobile = s_mobile; 
            updateData.subType = s_type; 
            updateData.region = 'NA';
            updateData.familyRole = 'Secondary'; 
            updateData.linkedPrimaryName = p_name; 
            updateData.linkedPrimaryNumber = p_mobile; 
            updateData.linkedPrimaryStatus = `Type: ${p_type}`;
            finalSubType = s_type;
        } else {
            updateData.name = n_name; 
            updateData.mobile = n_mobile; 
            updateData.subType = category; 
            updateData.region = 'NA';
            updateData.familyRole = '';
            updateData.linkedPrimaryName = ''; 
            updateData.linkedPrimaryNumber = ''; 
            updateData.linkedPrimaryStatus = '';
            finalSubType = category;
        }

        if(!finalSubType) finalSubType = existingDoc.subType || 'NC';

        const sLogic = calculateLogic(newEntryDate, finalSubType);
        let finalActDate = sLogic.realActivationDate;
        let finalVerDate = sLogic.realVerificationDate;

        if (category === 'Family') {
             const pLogic = calculateLogic(newEntryDate, p_type || 'NC');
             if (pLogic.realVerificationDate > finalVerDate) {
                 finalActDate = pLogic.realActivationDate;
                 finalVerDate = pLogic.realVerificationDate;
             }
        }

        updateData.createdAt = newEntryDate; 
        updateData.activationDate = finalActDate; 
        updateData.verificationDate = finalVerDate; 

        // 1. Update the Main clicked Document
        await Customer.findByIdAndUpdate(req.params.id, updateData);

        // 2. Safely Process Additional Secondaries (If any were submitted in Edit form)
        if (category === 'Family' && req.body.s_id) {
            const s_ids = Array.isArray(req.body.s_id) ? req.body.s_id : [req.body.s_id];
            const s_types = Array.isArray(req.body.s_type) ? req.body.s_type : [req.body.s_type];
            const s_names = Array.isArray(req.body.s_name) ? req.body.s_name : [req.body.s_name];
            const s_mobiles = Array.isArray(req.body.s_mobile) ? req.body.s_mobile : [req.body.s_mobile];
            
            const pLogic = calculateLogic(newEntryDate, p_type || 'NC');

            for (let i = 1; i < s_ids.length; i++) { // Skip 0 since it is handled by the main update above
                let cId = s_ids[i];
                let cName = s_names[i];
                let cMobile = s_mobiles[i];
                let cType = s_types[i] || 'NC';
                
                if (!cName || cName.trim() === '') continue;

                let secLogic = calculateLogic(newEntryDate, cType);
                let secAct = secLogic.realActivationDate;
                let secVer = secLogic.realVerificationDate;
                
                if (pLogic.realVerificationDate > secVer) { 
                    secAct = pLogic.realActivationDate; 
                    secVer = pLogic.realVerificationDate; 
                }

                if (cId && cId.length > 5) {
                    await Customer.findByIdAndUpdate(cId, { name: cName, mobile: cMobile, subType: cType, plan: plan, activationDate: secAct, verificationDate: secVer, linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, billDate: bDate });
                } else {
                    await new Customer({
                        name: cName, mobile: cMobile, category: 'Family', subType: cType, plan: plan, region: 'NA', familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, remarks: remarks || '', createdAt: newEntryDate, activationDate: secAct, verificationDate: secVer, status: 'pending', billDate: bDate
                    }).save();
                }
            }
        }

        safeRedirect(req, res);
    } catch (err) { 
        console.error('Edit Route Error:', err);
        safeRedirect(req, res); 
    }
});

router.post('/delete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
            await Customer.findOneAndDelete({ category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber });
        }
        await Customer.findByIdAndDelete(req.params.id); 
        safeRedirect(req, res);
    } catch (err) { 
        console.error('Delete Route Error:', err);
        safeRedirect(req, res); 
    } 
});

router.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if (doc) {
            await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' });
        }
        safeRedirect(req, res);
    } catch (err) { 
        console.error('Complete Route Error:', err);
        safeRedirect(req, res); 
    } 
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
    } catch(err) { 
        console.error('Pay Bill Error:', err);
        safeRedirect(req, res); 
    }
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
    } catch(err) { 
        console.error('Pay All Bills Error:', err);
        safeRedirect(req, res); 
    }
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
        console.error('Log Call Error:', err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;

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
        
        // 🕒 Exact End of Today Calculation in IST
        const d = new Date();
        const istNow = new Date(d.getTime() + (330 * 60000));
        const istEndOfDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999));
        const utcEndOfDay = new Date(istEndOfDay.getTime() - (330 * 60000));

        // 🛡️ Strict Filter: Never show 'Existing' on Verification Page
        let query = { 
            status: 'pending',
            subType: { $nin: ['Existing', 'existing', 'EXISTING', ' Existing', 'Existing '] },
            category: { $nin: ['Existing', 'existing', 'EXISTING'] }
        };
        
        let headerTitle = "All Pending";

        if (monthOffset === 'all') {
            // Only show tasks due today or earlier. Future dates hidden!
            query.verificationDate = { $lte: utcEndOfDay };
        } else {
            const { start, end } = getISTDate(monthOffset);
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            
            // Only show tasks strictly due up to the end of today
            if (utcEndOfDay < end) {
                query.verificationDate = { $gte: start, $lte: utcEndOfDay };
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
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });

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
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });

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
        // Safe String Extraction
        const getFirst = (val) => {
            let v = Array.isArray(val) ? val[0] : (val || '');
            return typeof v === 'string' ? v.trim() : v;
        };
        
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

            // Do not save Primary if it's 'Existing'
            if (p_type !== 'Existing') {
                const primaryCustomer = new Customer({
                    name: p_name, mobile: p_mobile, category: 'Family', subType: p_type, plan: plan, region: 'NA',
                    familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: 'pending', billDate: bDate
                });
                await primaryCustomer.save();
            }

            const s_types = Array.isArray(req.body.s_type) ? req.body.s_type : [req.body.s_type];
            const s_names = Array.isArray(req.body.s_name) ? req.body.s_name : [req.body.s_name];
            const s_mobiles = Array.isArray(req.body.s_mobile) ? req.body.s_mobile : [req.body.s_mobile];

            for (let i = 0; i < s_names.length; i++) {
                if (!s_names[i] || s_names[i].trim() === '') continue; 
                
                const sType = (s_types[i] || 'NC').trim();
                const sName = s_names[i].trim();
                const sMobile = s_mobiles[i].trim();

                const sLogic = calculateLogic(entryDate, sType);
                let finalActDate = sLogic.realActivationDate;
                let finalVerDate = sLogic.realVerificationDate;

                if (pLogic.realVerificationDate > finalVerDate) {
                    finalActDate = pLogic.realActivationDate;
                    finalVerDate = pLogic.realVerificationDate;
                }

                // If secondary is Existing, mark it completed immediately
                let secStatus = sType === 'Existing' ? 'completed' : 'pending';

                const secondaryCustomer = new Customer({
                    name: sName, mobile: sMobile, category: 'Family', subType: sType, plan: plan, region: 'NA',
                    familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                    remarks: remarks || '', createdAt: entryDate, activationDate: finalActDate, verificationDate: finalVerDate, status: secStatus, billDate: bDate
                });
                await secondaryCustomer.save();
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = getFirst(req.body.n_mobile);
            
            const nLogic = calculateLogic(entryDate, category);
            // If Normal category is Existing, it shouldn't show in pending verifications
            let nStatus = category === 'Existing' ? 'completed' : 'pending';
            
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, category: category, subType: category, plan: plan, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: nStatus, billDate: bDate
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
        const getFirst = (val) => {
            let v = Array.isArray(val) ? val[0] : (val || '');
            return typeof v === 'string' ? v.trim() : v;
        };
        
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

        // SAFELY HANDLE FAMILY PSEUDO ID
        const isFamGroup = req.params.id.startsWith('fam_');
        let existingDoc = null;
        
        if (isFamGroup) {
            const pNum = req.params.id.replace('fam_', '');
            existingDoc = await Customer.findOne({ 
                category: 'Family', 
                $or: [{ mobile: pNum, familyRole: 'Primary' }, { linkedPrimaryNumber: pNum }] 
            });
        } else {
            existingDoc = await Customer.findById(req.params.id);
        }

        if (!existingDoc) return safeRedirect(req, res);

        const newEntryDate = parseISTDateString(rawDate, existingDoc.createdAt);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (category === 'Family') {
            const oldPrimaryMobile = existingDoc.familyRole === 'Primary' ? existingDoc.mobile : existingDoc.linkedPrimaryNumber;
            const pLogic = calculateLogic(newEntryDate, p_type);
            
            // Primary logic: Update, Create, or set to Completed if 'Existing'
            if (p_type !== 'Existing') {
                const primaryUpdate = {
                    name: p_name, mobile: p_mobile, subType: p_type, plan: plan, 
                    createdAt: newEntryDate, activationDate: pLogic.realActivationDate, 
                    verificationDate: pLogic.realVerificationDate, billDate: bDate, remarks: remarks || '', status: 'pending'
                };
                const existingPrimary = await Customer.findOne({ category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile });
                if (existingPrimary) {
                    await Customer.findByIdAndUpdate(existingPrimary._id, primaryUpdate);
                } else {
                    await new Customer({ ...primaryUpdate, category: 'Family', familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account' }).save();
                }
            } else {
                // If user changes Primary to 'Existing', make sure to mark it completed so it disappears from verification
                await Customer.findOneAndUpdate(
                    { category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile },
                    { status: 'completed', subType: 'Existing', name: p_name, mobile: p_mobile }
                );
            }

            // Sync Secondaries
            await Customer.updateMany(
                { category: 'Family', familyRole: 'Secondary', linkedPrimaryNumber: oldPrimaryMobile },
                { linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, plan: plan, remarks: remarks || '' }
            );

            // Handle Secondaries (Dynamic Array processing)
            const getArray = (val) => {
                if (val === undefined || val === null) return [];
                return Array.isArray(val) ? val : [val];
            };

            const s_ids = getArray(req.body.s_id);
            const s_types = getArray(req.body.s_type);
            const s_names = getArray(req.body.s_name);
            const s_mobiles = getArray(req.body.s_mobile);

            for (let i = 0; i < s_names.length; i++) {
                let cId = s_ids[i];
                let cName = typeof s_names[i] === 'string' ? s_names[i].trim() : '';
                let cMobile = typeof s_mobiles[i] === 'string' ? s_mobiles[i].trim() : '';
                let cType = typeof s_types[i] === 'string' ? s_types[i].trim() : 'NC';
                
                if (!cName || cName === '') continue;

                let secLogic = calculateLogic(newEntryDate, cType);
                let secAct = secLogic.realActivationDate;
                let secVer = secLogic.realVerificationDate;
                
                if (pLogic.realVerificationDate > secVer) { 
                    secAct = pLogic.realActivationDate; 
                    secVer = pLogic.realVerificationDate; 
                }

                let secStatus = cType === 'Existing' ? 'completed' : 'pending';

                if (cId && cId.length > 5 && cId !== 'undefined') {
                    await Customer.findByIdAndUpdate(cId, { 
                        name: cName, mobile: cMobile, subType: cType, plan: plan, 
                        activationDate: secAct, verificationDate: secVer, 
                        linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, billDate: bDate,
                        remarks: remarks || '', createdAt: newEntryDate, status: secStatus
                    });
                } else {
                    await new Customer({
                        name: cName, mobile: cMobile, category: 'Family', subType: cType, plan: plan, region: 'NA', 
                        familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, remarks: remarks || '', 
                        createdAt: newEntryDate, activationDate: secAct, verificationDate: secVer, status: secStatus, billDate: bDate
                    }).save();
                }
            }
        } else {
            // Normal Customer Edit
            let updateData = { 
                category, remarks, plan, billDate: bDate,
                name: n_name, mobile: n_mobile, subType: category,
                region: 'NA', familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                status: category === 'Existing' ? 'completed' : 'pending' // Force existing to bypass pending queue
            };
            
            const nLogic = calculateLogic(newEntryDate, category);
            updateData.createdAt = newEntryDate; 
            updateData.activationDate = nLogic.realActivationDate; 
            updateData.verificationDate = nLogic.realVerificationDate; 

            if (!isFamGroup) {
                await Customer.findByIdAndUpdate(req.params.id, updateData);
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
        const isFamGroup = req.params.id.startsWith('fam_');
        
        if (isFamGroup) {
            const pNum = req.params.id.replace('fam_', '');
            await Customer.deleteMany({ category: 'Family', $or: [{mobile: pNum, familyRole: 'Primary'}, {linkedPrimaryNumber: pNum}] });
        } else {
            const doc = await Customer.findById(req.params.id);
            if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
                await Customer.findOneAndDelete({ category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber });
            }
            await Customer.findByIdAndDelete(req.params.id); 
        }
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

// Smart Notification API (Today's Agenda)
router.get('/api/agenda', isAuthenticated, async (req, res) => {
    try {
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();

        // Exact End of Today in UTC
        const istEndOfDay = new Date(Date.UTC(currentYear, currentMonth, currentDay, 23, 59, 59, 999));
        const utcEndOfDay = new Date(istEndOfDay.getTime() - (330 * 60000));

        // 1. Pending Verifications (Strict exclusion of Existing and Future Dates)
        const query = { 
            status: 'pending',
            subType: { $nin: ['Existing', 'existing', 'EXISTING', ' Existing', 'Existing '] },
            category: { $nin: ['Existing', 'existing', 'EXISTING'] },
            verificationDate: { $lte: utcEndOfDay }
        };
        const pendingVerifications = await Customer.countDocuments(query);

        // 2. Pending Bills
        const customersForBills = await Customer.find({ billDate: { $ne: null } }).lean();
        let pendingBills = 0;

        customersForBills.forEach(c => {
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
                    pendingBills++;
                }
            }
        });

        res.json({ pendingVerifications, pendingBills, total: pendingVerifications + pendingBills });
    } catch (err) {
        console.error('Agenda API Error:', err);
        res.status(500).json({ pendingVerifications: 0, pendingBills: 0, total: 0 });
    }
});

module.exports = router;
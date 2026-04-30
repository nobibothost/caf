const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const { getISTDate, getRuns, getPayout, calculateLogic } = require('../utils/helpers');

router.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let startQuery = req.query.start; let endQuery = req.query.end; let isCustomDate = startQuery && endQuery;
        let daterange = ''; const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        let headerTitle = "All Time Analysis"; let start, end, now = new Date();

        if (isCustomDate) {
            const sParts = startQuery.split('-'); const eParts = endQuery.split('-');
            start = new Date(Date.UTC(sParts[0], sParts[1]-1, sParts[2], 0, 0, 0) - (330 * 60000));
            end = new Date(Date.UTC(eParts[0], eParts[1]-1, parseInt(eParts[2])+1, 0, 0, 0) - (330 * 60000));
            headerTitle = `Analysis: ${sParts[2]}/${sParts[1]}/${sParts[0]} to ${eParts[2]}/${eParts[1]}/${eParts[0]}`;
            monthOffset = 'custom'; daterange = `${startQuery} to ${endQuery}`;
        } else {
            const dateObj = getISTDate(monthOffset === 'all' ? 0 : monthOffset);
            start = dateObj.start; end = dateObj.end; now = dateObj.now;
            if (monthOffset !== 'all') {
                const displayMonth = new Date(start); displayMonth.setMinutes(displayMonth.getMinutes() + 330);
                headerTitle = "Analysis: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
            }
        }

        const allCustomers = await Customer.find().lean();
        
        const stats = { 
            total: 0, activated: 0, runs: 0, revenue: 0, 
            mnpFamily: { count: 0, rev: 0 },
            otherFamily: { count: 0, rev: 0 },
            mnpNonFamily: { count: 0, rev: 0 },
            freshNonFamily: { count: 0, rev: 0 },
            p2pNonFamily: { count: 0, rev: 0 },
            completed: 0, pending: 0, 
            carry_activated: 0, carry_revenue: 0 
        };
        
        const pendingListRaw = [];

        allCustomers.forEach(c => {
            const cEntry = new Date(c.createdAt); let cAct = new Date(c.activationDate || c.createdAt); 
            let isEntryThisMonth = false; let isActThisMonth = false;

            if (monthOffset === 'all') { isEntryThisMonth = true; isActThisMonth = true; } 
            else { if (cEntry >= start && cEntry < end) isEntryThisMonth = true; if (cAct >= start && cAct < end) isActThisMonth = true; }

            // 🔥 STRICT FIX: Reject "Existing" status completely from being treated as a new entry
            let isExisting = (c.subType === 'Existing' || c.category === 'Existing');

            // Total entries mein bhi isExisting ko filter kar diya
            if (isEntryThisMonth && !isExisting) { 
                stats.total++; 
            }

            if (isActThisMonth) {
                let isCarry = false; if (monthOffset !== 'all') { isCarry = (cEntry < start); }

                const istNow = new Date(new Date().getTime() + (330 * 60000));
                let isActuallyActivated = (cAct <= istNow) || (c.status === 'completed');
                
                if (isActuallyActivated) {
                    if (!isExisting) {
                        let isMnp = (c.subType === 'MNP' || c.subType === 'NMNP' || c.category === 'MNP' || c.category === 'NMNP');
                        let isP2p = (c.subType === 'P2P' || c.category === 'P2P');
                        let isFamily = (c.category === 'Family');
                        
                        let earned = 0;
                        try { earned = getPayout(c.category, c.subType, c.plan) || 0; } catch(e) {}
                        
                        if (isFamily) {
                            if (isMnp) { 
                                stats.mnpFamily.count++; stats.mnpFamily.rev += earned; 
                            } else { 
                                stats.otherFamily.count++; stats.otherFamily.rev += earned; 
                            }
                        } else {
                            if (isMnp) { 
                                stats.mnpNonFamily.count++; stats.mnpNonFamily.rev += earned; 
                            } else if (isP2p) { 
                                stats.p2pNonFamily.count++; stats.p2pNonFamily.rev += earned; 
                            } else { 
                                stats.freshNonFamily.count++; stats.freshNonFamily.rev += earned; 
                            }
                        }

                        stats.activated++;
                        stats.revenue += earned;
                        if (isCarry) { stats.carry_activated++; stats.carry_revenue += earned; }
                    }
                }

                if (!isExisting) {
                    stats.runs += getRuns(c.category, c.subType);
                }
                
                if (c.status === 'completed') stats.completed++; else stats.pending++;
            }

            const istNowForPending = new Date(new Date().getTime() + (330 * 60000));
            if (c.status === 'pending' && cAct > istNowForPending) {
                if (monthOffset === 'all' || isActThisMonth || isEntryThisMonth) {
                    c.dynamicActDate = cAct; pendingListRaw.push(c);
                }
            }
        });

        const pendingList = pendingListRaw.filter(c => !(c.category === 'Family' && c.familyRole === 'Primary')).sort((a, b) => a.dynamicActDate - b.dynamicActDate);
        res.render('analytics', { stats, pendingList, page: 'analytics', monthOffset, headerTitle, daterange });
    } catch (err) { res.redirect('/'); }
});

router.post('/log-call/:id', isAuthenticated, async (req, res) => {
    try {
        const { pageType, reason, notes } = req.body;
        await Customer.findByIdAndUpdate(req.params.id, { $push: { callLogs: { callDate: new Date(), pageType, reason, notes } } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

router.get('/api/agenda', isAuthenticated, async (req, res) => {
    try {
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();

        const istEndOfDay = new Date(Date.UTC(currentYear, currentMonth, currentDay, 23, 59, 59, 999));
        const utcEndOfDay = new Date(istEndOfDay.getTime() - (330 * 60000));

        const query = { status: 'pending', subType: { $nin: ['Existing', 'existing', 'EXISTING', ' Existing', 'Existing '] }, category: { $nin: ['Existing', 'existing', 'EXISTING'] }, verificationDate: { $lte: utcEndOfDay } };
        const pendingVerifications = await Customer.countDocuments(query);

        const customersForBills = await Customer.find({ billDate: { $ne: null } }).lean();
        let pendingBills = 0;

        customersForBills.forEach(c => {
            let billYear = currentYear; let billMonth = currentMonth;
            if (currentDay <= c.billDate) { billMonth -= 1; if (billMonth < 0) { billMonth = 11; billYear -= 1; } }

            const dynamicLogic = calculateLogic(c.createdAt, c.subType || c.category);
            const actDate = dynamicLogic.realActivationDate;
            const actIst = new Date(actDate.getTime() + (330 * 60000));
            const actYear = actIst.getUTCFullYear(); const actMonth = actIst.getUTCMonth(); const actDay = actIst.getUTCDate();

            const calcBillVal = billYear * 10000 + billMonth * 100 + c.billDate;
            const actVal = actYear * 10000 + actMonth * 100 + actDay;

            if (calcBillVal >= actVal) {
                const cycleKey = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;
                if (!c.paidMonths || !c.paidMonths.includes(cycleKey)) {
                    let cycleNum = (billYear - actYear) * 12 + (billMonth - actMonth);
                    if (c.billDate >= actDay) cycleNum += 1;
                    let effectiveCycle = cycleNum > 0 ? cycleNum : 1;
                    let maxBills = (c.subType === 'MNP' || c.subType === 'NMNP' || c.category === 'MNP' || c.category === 'NMNP') ? 4 : 3;
                    if (effectiveCycle <= maxBills) pendingBills++;
                }
            }
        });
        res.json({ pendingVerifications, pendingBills, total: pendingVerifications + pendingBills });
    } catch (err) { res.status(500).json({ pendingVerifications: 0, pendingBills: 0, total: 0 }); }
});

router.get('/backup', isAuthenticated, async (req, res) => {
    try {
        const allCustomers = await Customer.find().lean();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-disposition', `attachment; filename=verifyhub_backup_${timestamp}.json`);
        res.setHeader('Content-type', 'application/json');
        res.write(JSON.stringify(allCustomers, null, 2));
        res.end();
    } catch (err) { res.status(500).send('Database Backup Failed'); }
});

module.exports = router;
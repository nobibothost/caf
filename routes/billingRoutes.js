// routes/billingRoutes.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const { getISTDate, calculateLogic, safeRedirect } = require('../utils/helpers');

const ITEMS_PER_PAGE = 10;
const getOrdinalSuffix = (i) => {
    let j = i % 10, k = i % 100;
    if (j == 1 && k != 11) return i + "st";
    if (j == 2 && k != 12) return i + "nd";
    if (j == 3 && k != 13) return i + "rd";
    return i + "th";
};

router.get('/pdd', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; const monthQuery = req.query.month;
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let startQuery = req.query.start; let endQuery = req.query.end; let isCustomDate = startQuery && endQuery;
        let daterange = ''; let headerTitle = "PDD Tracking";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        let filterStart, filterEnd;

        if (isCustomDate) {
            const sParts = startQuery.split('-'); const eParts = endQuery.split('-');
            filterStart = new Date(Date.UTC(sParts[0], sParts[1]-1, sParts[2], 0, 0, 0) - (330 * 60000));
            filterEnd = new Date(Date.UTC(eParts[0], eParts[1]-1, parseInt(eParts[2])+1, 0, 0, 0) - (330 * 60000));
            headerTitle = `PDD: ${sParts[2]}/${sParts[1]}/${sParts[0]} to ${eParts[2]}/${eParts[1]}/${eParts[0]}`;
            monthOffset = 'custom'; daterange = `${startQuery} to ${endQuery}`;
        } else if (monthOffset !== 'all') {
            const { start, end } = getISTDate(monthOffset); filterStart = start; filterEnd = end;
            const displayMonth = new Date(start); displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "PDD: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        } else { headerTitle = "All Pending Bills"; }

        const customers = await Customer.find({ billDate: { $ne: null } }).lean();
        const today = new Date(); const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate(); const currentMonth = istNow.getUTCMonth(); const currentYear = istNow.getUTCFullYear();
        let pendingBillsRaw = [];

        customers.forEach(c => {
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
                    const exactBillDate = new Date(Date.UTC(billYear, billMonth, c.billDate, 0, 0, 0) - (330 * 60000));
                    const exactDueDate = new Date(exactBillDate.getTime() + (10 * 24 * 60 * 60 * 1000));
                    let cycleNum = (billYear - actYear) * 12 + (billMonth - actMonth);
                    if (c.billDate >= actDay) cycleNum += 1;
                    
                    let effectiveCycle = cycleNum > 0 ? cycleNum : 1;
                    let maxBills = (c.subType === 'MNP' || c.subType === 'NMNP' || c.category === 'MNP' || c.category === 'NMNP') ? 4 : 3;

                    if (effectiveCycle <= maxBills) {
                        let cycleString = getOrdinalSuffix(effectiveCycle) + " Bill";
                        c.exactBillDate = exactBillDate; c.exactDueDate = exactDueDate;
                        pendingBillsRaw.push({ ...c, cycleKey, cycleString });
                    }
                }
            }
        });

        let pendingBills = pendingBillsRaw;
        if (monthOffset !== 'all') { pendingBills = pendingBillsRaw.filter(b => b.exactBillDate >= filterStart && b.exactBillDate < filterEnd); }
        pendingBills.sort((a, b) => a.exactBillDate - b.exactBillDate);
        const totalPages = Math.ceil(pendingBills.length / ITEMS_PER_PAGE);
        const paginatedBills = pendingBills.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        res.render('pdd', { pendingBills: paginatedBills, page: 'pdd', headerTitle, currentPage: page, totalPages, monthOffset, daterange });
    } catch (err) { res.redirect('/'); }
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
            await Customer.findByIdAndUpdate(req.params.id, { $addToSet: { paidMonths: cycleKey } });
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
                    let cycleNum = (billYear - actYear) * 12 + (billMonth - actMonth);
                    if (c.billDate >= actDay) cycleNum += 1;
                    
                    let effectiveCycle = cycleNum > 0 ? cycleNum : 1;
                    let maxBills = (c.subType === 'MNP' || c.subType === 'NMNP' || c.category === 'MNP' || c.category === 'NMNP') ? 4 : 3;

                    if (effectiveCycle <= maxBills) {
                        bulkOps.push({ updateOne: { filter: { _id: c._id }, update: { $addToSet: { paidMonths: cycleKey } } } });
                        if (c.category === 'Family' && c.familyRole === 'Secondary') {
                            bulkOps.push({ updateOne: { filter: { category: 'Family', familyRole: 'Primary', mobile: c.linkedPrimaryNumber }, update: { $addToSet: { paidMonths: cycleKey } } } });
                        }
                    }
                }
            }
        });

        if (bulkOps.length > 0) { await Customer.bulkWrite(bulkOps); }
        safeRedirect(req, res);
    } catch(err) { safeRedirect(req, res); }
});

module.exports = router;
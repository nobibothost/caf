// routes/viewRoutes.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const { getISTDate, fetchGroupedCustomers } = require('../utils/helpers');

const ITEMS_PER_PAGE = 10;

router.get('/', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let startQuery = req.query.start;
        let endQuery = req.query.end;
        let isCustomDate = startQuery && endQuery;
        let daterange = '';
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const d = new Date();
        const istNow = new Date(d.getTime() + (330 * 60000));
        const istEndOfDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999));
        const utcEndOfDay = new Date(istEndOfDay.getTime() - (330 * 60000));

        let query = { status: 'pending', subType: { $nin: ['Existing', 'existing', 'EXISTING', ' Existing', 'Existing '] }, category: { $nin: ['Existing', 'existing', 'EXISTING'] } };
        let headerTitle = "All Pending";

        if (isCustomDate) {
            const sParts = startQuery.split('-'); const eParts = endQuery.split('-');
            const sUTC = new Date(Date.UTC(sParts[0], sParts[1]-1, sParts[2], 0, 0, 0) - (330 * 60000));
            const eUTC = new Date(Date.UTC(eParts[0], eParts[1]-1, eParts[2], 23, 59, 59, 999) - (330 * 60000));
            query.verificationDate = { $gte: sUTC, $lte: eUTC };
            headerTitle = `Pending: ${sParts[2]}/${sParts[1]}/${sParts[0]} to ${eParts[2]}/${eParts[1]}/${eParts[0]}`;
            monthOffset = 'custom'; daterange = `${startQuery} to ${endQuery}`;
        } else if (monthOffset === 'all') {
            query.verificationDate = { $lte: utcEndOfDay };
        } else {
            const { start, end } = getISTDate(monthOffset);
            const displayMonth = new Date(start); displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            if (utcEndOfDay < end) query.verificationDate = { $gte: start, $lte: utcEndOfDay };
            else query.verificationDate = { $gte: start, $lt: end };
            headerTitle = "Pending: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        }
        
        const fullCustomers = await fetchGroupedCustomers(query, { verificationDate: 1 });
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        res.render('index', { customers: paginatedCustomers, error: null, page: 'home', monthOffset, headerTitle, currentPage: page, totalPages, daterange });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error", currentPage: 1, totalPages: 1, daterange: '' }); }
});

router.get('/all', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let startQuery = req.query.start; let endQuery = req.query.end; let isCustomDate = startQuery && endQuery;
        let daterange = ''; let query = {}; let headerTitle = "All History";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        if (isCustomDate) {
            const sParts = startQuery.split('-'); const eParts = endQuery.split('-');
            const sUTC = new Date(Date.UTC(sParts[0], sParts[1]-1, sParts[2], 0, 0, 0) - (330 * 60000));
            const eUTC = new Date(Date.UTC(eParts[0], eParts[1]-1, parseInt(eParts[2])+1, 0, 0, 0) - (330 * 60000));
            query = { $or: [{ createdAt: { $gte: sUTC, $lt: eUTC } }, { activationDate: { $gte: sUTC, $lt: eUTC } }] }; 
            headerTitle = `History: ${sParts[2]}/${sParts[1]}/${sParts[0]} to ${eParts[2]}/${eParts[1]}/${eParts[0]}`;
            monthOffset = 'custom'; daterange = `${startQuery} to ${endQuery}`;
        } else if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { $or: [{ createdAt: { $gte: start, $lt: end } }, { activationDate: { $gte: start, $lt: end } }] }; 
            const displayMonth = new Date(start); displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "History: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        }
        
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        res.render('all', { customers: paginatedCustomers, page: 'all', monthOffset, headerTitle, currentPage: page, totalPages, daterange });
    } catch (err) { res.redirect('/'); }
});

router.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let startQuery = req.query.start; let endQuery = req.query.end; let isCustomDate = startQuery && endQuery;
        let daterange = ''; let query = {}; let headerTitle = "Managing All Records";
        
        if (isCustomDate) {
            const sParts = startQuery.split('-'); const eParts = endQuery.split('-');
            const sUTC = new Date(Date.UTC(sParts[0], sParts[1]-1, sParts[2], 0, 0, 0) - (330 * 60000));
            const eUTC = new Date(Date.UTC(eParts[0], eParts[1]-1, parseInt(eParts[2])+1, 0, 0, 0) - (330 * 60000));
            query = { $or: [{ createdAt: { $gte: sUTC, $lt: eUTC } }, { activationDate: { $gte: sUTC, $lt: eUTC } }] }; 
            headerTitle = `Managing: ${sParts[2]}/${sParts[1]}/${sParts[0]} to ${eParts[2]}/${eParts[1]}/${eParts[0]}`;
            monthOffset = 'custom'; daterange = `${startQuery} to ${endQuery}`;
        } else if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { $or: [{ createdAt: { $gte: start, $lt: end } }, { activationDate: { $gte: start, $lt: end } }] }; 
        }
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        res.render('manage', { customers: paginatedCustomers, page: 'manage', monthOffset, headerTitle, currentPage: page, totalPages, daterange });
    } catch (err) { res.redirect('/'); }
});

router.get('/search', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; const q = req.query.q ? req.query.q.trim() : '';
        let fullCustomers = [];
        if (q) {
            const regex = new RegExp(q, 'i');
            // 🔥 STRICT MATCHING FIX: Removed linkedPrimaryNumber and linkedPrimaryName so it only searches exactly for the person you typed!
            fullCustomers = await fetchGroupedCustomers({ $or: [{ name: regex }, { mobile: regex }] }, { createdAt: -1 });
        }
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        res.render('search', { customers: paginatedCustomers, query: q, page: 'search', headerTitle: "Global Search", currentPage: page, totalPages, totalItems: fullCustomers.length });
    } catch (err) { res.redirect('/'); }
});

module.exports = router;
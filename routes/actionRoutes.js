// routes/actionRoutes.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const { parseISTDateString, calculateLogic, safeRedirect } = require('../utils/helpers');
const { getFinalActDate, guessGenderAI } = require('../utils/smartHelpers');

// ==========================================
// ADD ROUTE
// ==========================================
router.post('/add', isAuthenticated, async (req, res) => {
    try {
        const getFirst = (val) => { let v = Array.isArray(val) ? val[0] : (val || ''); return typeof v === 'string' ? v.trim() : v; };
        
        const category = getFirst(req.body.category);
        const rawDate = getFirst(req.body.customDate) || getFirst(req.body.activationDate) || getFirst(req.body.editDate);
        const remarks = getFirst(req.body.remarks);
        const plan = getFirst(req.body.plan);
        const billDateStr = getFirst(req.body.billDate);

        const entryDate = parseISTDateString(rawDate);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (category === 'Family') {
            const p_type = getFirst(req.body.p_type) || 'NC';
            let p_name = getFirst(req.body.p_name);
            const p_mobile = getFirst(req.body.p_mobile);
            
            // Prevent mobile number from being saved as Name
            if (!p_name || p_name.trim() === '' || p_name === p_mobile) {
                p_name = 'Primary Account'; 
            }
            
            let p_gender = getFirst(req.body.p_gender) || 'KEEP';
            if (p_gender === 'KEEP' || p_gender === '') {
                p_gender = await guessGenderAI(p_name);
            } else if (p_gender === 'CLEAR') {
                p_gender = '';
            }

            const pLogic = calculateLogic(entryDate, p_type);
            pLogic.realActivationDate = await getFinalActDate(entryDate, p_type, pLogic.realActivationDate);

            let existingPrimary = await Customer.findOne({ category: 'Family', familyRole: 'Primary', mobile: p_mobile });
            const pStatus = p_type === 'Existing' ? 'completed' : 'pending';
            
            const primaryUpdateData = {
                name: p_name, mobile: p_mobile, gender: p_gender, category: 'Family', subType: p_type, plan: plan, region: 'NA',
                familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: pStatus, billDate: bDate
            };

            if (existingPrimary) {
                if (p_type === 'Existing') primaryUpdateData.subType = existingPrimary.subType;
                await Customer.findByIdAndUpdate(existingPrimary._id, primaryUpdateData);
            } else {
                await new Customer(primaryUpdateData).save();
            }

            const s_types = Array.isArray(req.body.s_type) ? req.body.s_type : [req.body.s_type];
            const s_names = Array.isArray(req.body.s_name) ? req.body.s_name : [req.body.s_name];
            const s_mobiles = Array.isArray(req.body.s_mobile) ? req.body.s_mobile : [req.body.s_mobile];
            const s_genders = Array.isArray(req.body.s_gender) ? req.body.s_gender : [req.body.s_gender];

            for (let i = 0; i < s_names.length; i++) {
                if (!s_names[i] || s_names[i].trim() === '') continue;

                const sType = (s_types[i] || 'NC').trim();
                const sName = s_names[i].trim();
                const sMobile = s_mobiles[i].trim();
                
                let sGender = (s_genders[i] || 'KEEP').trim();
                if (sGender === 'KEEP' || sGender === '') sGender = await guessGenderAI(sName);
                else if (sGender === 'CLEAR') sGender = '';

                const sLogic = calculateLogic(entryDate, sType);
                let finalActDate = await getFinalActDate(entryDate, sType, sLogic.realActivationDate);
                let finalVerDate = sLogic.realVerificationDate;

                if (pLogic.realVerificationDate > finalVerDate) {
                    finalActDate = pLogic.realActivationDate; finalVerDate = pLogic.realVerificationDate;
                }

                let secStatus = sType === 'Existing' ? 'completed' : 'pending';

                const secondaryCustomer = new Customer({
                    name: sName, mobile: sMobile, gender: sGender, category: 'Family', subType: sType, plan: plan, region: 'NA',
                    familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                    remarks: remarks || '', createdAt: entryDate, activationDate: finalActDate, verificationDate: finalVerDate, status: secStatus, billDate: bDate
                });
                await secondaryCustomer.save();
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = getFirst(req.body.n_mobile);
            
            let gender = getFirst(req.body.gender) || 'KEEP';
            if (gender === 'KEEP' || gender === '') gender = await guessGenderAI(n_name);
            else if (gender === 'CLEAR') gender = '';
            
            const nLogic = calculateLogic(entryDate, category);
            nLogic.realActivationDate = await getFinalActDate(entryDate, category, nLogic.realActivationDate);
            let nStatus = category === 'Existing' ? 'completed' : 'pending';
            
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, gender: gender, category: category, subType: category, plan: plan, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: nStatus, billDate: bDate
            });
            await newCustomer.save();
        }
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

// ==========================================
// EDIT ROUTE 
// ==========================================
router.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const getFirst = (val) => { let v = Array.isArray(val) ? val[0] : (val || ''); return typeof v === 'string' ? v.trim() : v; };
        
        const category = getFirst(req.body.category);
        const rawDate = getFirst(req.body.activationDate) || getFirst(req.body.customDate) || getFirst(req.body.editDate);
        const remarks = getFirst(req.body.remarks);
        const plan = getFirst(req.body.plan);
        const billDateStr = getFirst(req.body.billDate);

        const isFamGroup = req.params.id.startsWith('fam_');
        let existingDoc = null;
        
        if (isFamGroup) {
            const pNum = req.params.id.replace('fam_', '');
            existingDoc = await Customer.findOne({ category: 'Family', $or: [{ mobile: pNum, familyRole: 'Primary' }, { linkedPrimaryNumber: pNum }] });
        } else {
            existingDoc = await Customer.findById(req.params.id);
        }

        if (!existingDoc) return safeRedirect(req, res);

        const newEntryDate = parseISTDateString(rawDate, existingDoc.createdAt);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (category === 'Family') {
            const p_type = getFirst(req.body.p_type);
            const p_mobile = getFirst(req.body.p_mobile);
            let p_name = getFirst(req.body.p_name);
            
            // Prevent mobile number from being saved as Name
            if (!p_name || p_name.trim() === '' || p_name === p_mobile) {
                p_name = 'Primary Account'; 
            }
            
            let p_gender = getFirst(req.body.p_gender) || 'KEEP';

            const oldPrimaryMobile = existingDoc.familyRole === 'Primary' ? existingDoc.mobile : existingDoc.linkedPrimaryNumber;
            const existingPrimary = await Customer.findOne({ category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile });

            let finalPGender = existingPrimary ? existingPrimary.gender : '';
            if (p_gender === 'Male' || p_gender === 'Female') { finalPGender = p_gender; } 
            else if (p_gender === 'CLEAR') { finalPGender = ''; }
            
            if (p_gender === 'KEEP' && (!finalPGender || finalPGender.trim() === '')) {
                finalPGender = await guessGenderAI(p_name);
            }

            const pLogic = calculateLogic(newEntryDate, p_type);
            pLogic.realActivationDate = await getFinalActDate(newEntryDate, p_type, pLogic.realActivationDate);
            
            // 🔥 FIX: FORCE UPDATE FULL PRIMARY DETAILS EVEN IF "EXISTING"
            const primaryUpdateData = {
                name: p_name, mobile: p_mobile, gender: finalPGender, subType: p_type, plan: plan, 
                createdAt: newEntryDate, activationDate: pLogic.realActivationDate, 
                verificationDate: pLogic.realVerificationDate, billDate: bDate, remarks: remarks || '', 
                status: p_type === 'Existing' ? 'completed' : 'pending'
            };

            if (existingPrimary) { 
                await Customer.findByIdAndUpdate(existingPrimary._id, primaryUpdateData); 
            } else { 
                await new Customer({ ...primaryUpdateData, category: 'Family', familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account' }).save(); 
            }

            await Customer.updateMany({ category: 'Family', familyRole: 'Secondary', linkedPrimaryNumber: oldPrimaryMobile }, { linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, plan: plan, remarks: remarks || '' });

            const getArray = (val) => { if (val === undefined || val === null) return []; return Array.isArray(val) ? val : [val]; };
            const s_ids = getArray(req.body.s_id); const s_types = getArray(req.body.s_type); const s_names = getArray(req.body.s_name);
            const s_mobiles = getArray(req.body.s_mobile); const s_genders = getArray(req.body.s_gender);

            for (let i = 0; i < s_names.length; i++) {
                let cId = s_ids[i]; let cName = typeof s_names[i] === 'string' ? s_names[i].trim() : '';
                let cMobile = typeof s_mobiles[i] === 'string' ? s_mobiles[i].trim() : '';
                let cType = typeof s_types[i] === 'string' ? s_types[i].trim() : 'NC';
                let cGender = typeof s_genders[i] === 'string' ? s_genders[i].trim() : 'KEEP';

                if (!cName || cName === '') continue;

                let existingSec = null;
                if (cId && cId.length > 5 && cId !== 'undefined') existingSec = await Customer.findById(cId);
                
                let finalSGender = existingSec ? existingSec.gender : '';
                if (cGender === 'Male' || cGender === 'Female') { finalSGender = cGender; } 
                else if (cGender === 'CLEAR') { finalSGender = ''; }
                else if (cGender === 'KEEP' && (!finalSGender || finalSGender.trim() === '')) {
                    finalSGender = await guessGenderAI(cName);
                }

                let secLogic = calculateLogic(newEntryDate, cType);
                let secAct = await getFinalActDate(newEntryDate, cType, secLogic.realActivationDate);
                let secVer = secLogic.realVerificationDate;
                if (pLogic.realVerificationDate > secVer) { secAct = pLogic.realActivationDate; secVer = pLogic.realVerificationDate; }
                let secStatus = cType === 'Existing' ? 'completed' : 'pending';

                if (cId && cId.length > 5 && cId !== 'undefined') {
                    await Customer.findByIdAndUpdate(cId, { 
                        name: cName, mobile: cMobile, gender: finalSGender, subType: cType, plan: plan, 
                        activationDate: secAct, verificationDate: secVer, linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, billDate: bDate, remarks: remarks || '', createdAt: newEntryDate, status: secStatus
                    });
                } else {
                    await new Customer({
                        name: cName, mobile: cMobile, gender: finalSGender, category: 'Family', subType: cType, plan: plan, region: 'NA', 
                        familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, remarks: remarks || '', createdAt: newEntryDate, activationDate: secAct, verificationDate: secVer, status: secStatus, billDate: bDate
                    }).save();
                }
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = getFirst(req.body.n_mobile);
            const gender = getFirst(req.body.gender) || 'KEEP';

            let finalGender = existingDoc.gender;
            if (gender === 'Male' || gender === 'Female') { finalGender = gender; } 
            else if (gender === 'CLEAR') { finalGender = ''; }
            else if (gender === 'KEEP' && (!finalGender || finalGender.trim() === '')) {
                finalGender = await guessGenderAI(n_name);
            }

            let updateData = { 
                category, remarks, plan, billDate: bDate,
                name: n_name, mobile: n_mobile, gender: finalGender, subType: category,
                region: 'NA', familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                status: category === 'Existing' ? 'completed' : 'pending' 
            };

            const nLogic = calculateLogic(newEntryDate, category);
            updateData.createdAt = newEntryDate; 
            updateData.activationDate = await getFinalActDate(newEntryDate, category, nLogic.realActivationDate); 
            updateData.verificationDate = nLogic.realVerificationDate;
            if (!isFamGroup) await Customer.findByIdAndUpdate(req.params.id, updateData);
        }
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
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
    } catch (err) { safeRedirect(req, res); } 
});

router.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if (doc) await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' });
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

module.exports = router;
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');
const { parseISTDateString, calculateLogic, safeRedirect } = require('../utils/helpers');
const { getFinalActDate, guessGenderAI } = require('../utils/smartHelpers');
const { sendAutoWaMessage } = require('../utils/whatsapp'); 

// ==========================================
// BACKGROUND AUTOMATED WHATSAPP ROUTE
// ==========================================
router.post('/send-wa/:phone', isAuthenticated, async (req, res) => {
    try {
        const phone = req.params.phone;
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, msg: "Message content is required" });
        }
        
        const isSent = await sendAutoWaMessage(phone, message);
        if (isSent) {
            res.json({ success: true, msg: "WhatsApp message sent successfully in background!" });
        } else {
            res.status(500).json({ success: false, msg: "Failed to send WhatsApp message. Make sure your phone is connected." });
        }
    } catch (err) {
        res.status(500).json({ success: false, msg: "Internal Server Error" });
    }
});

const getArray = (val) => { if (val === undefined || val === null) return []; return Array.isArray(val) ? val : [val]; };
// Helper to aggressively strip spaces to prevent matching errors
const cleanMobile = (str) => (str || '').toString().trim().replace(/\s+/g, '');

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
            const p_mobile = cleanMobile(getFirst(req.body.p_mobile));
            
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

            let existingPrimary = await Customer.findOne({ mobile: p_mobile, familyRole: { $ne: 'Secondary' } }).sort({ createdAt: -1 });
            let finalGroupId = existingPrimary ? (existingPrimary.groupId || existingPrimary._id.toString()) : new mongoose.Types.ObjectId().toString();
            
            let finalRemarks = remarks;
            if ((!finalRemarks || finalRemarks.trim() === '') && existingPrimary && existingPrimary.remarks) {
                finalRemarks = existingPrimary.remarks;
            }
            
            const pStatus = p_type === 'Existing' ? 'completed' : 'pending';
            
            const primaryUpdateData = {
                groupId: finalGroupId,
                name: p_name, mobile: p_mobile, gender: p_gender, category: 'Family', subType: p_type, plan: plan, region: 'NA',
                familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                remarks: finalRemarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: pStatus, billDate: bDate
            };

            if (existingPrimary) {
                if (p_type === 'Existing') primaryUpdateData.subType = existingPrimary.subType;
                if (p_gender === 'KEEP') delete primaryUpdateData.gender;
                
                delete primaryUpdateData.createdAt;
                delete primaryUpdateData.activationDate;
                delete primaryUpdateData.verificationDate;

                await Customer.findByIdAndUpdate(existingPrimary._id, primaryUpdateData);
                await Customer.deleteMany({ mobile: p_mobile, _id: { $ne: existingPrimary._id }, familyRole: { $ne: 'Secondary' } });
            } else {
                let newPrim = await new Customer(primaryUpdateData).save();
                await Customer.deleteMany({ mobile: p_mobile, _id: { $ne: newPrim._id }, familyRole: { $ne: 'Secondary' } });
            }

            const s_types = getArray(req.body.s_type);
            const s_names = getArray(req.body.s_name);
            const s_mobiles = getArray(req.body.s_mobile);
            const s_genders = getArray(req.body.s_gender);
            const s_dates = getArray(req.body.s_date);

            for (let i = 0; i < s_names.length; i++) {
                if (!s_names[i] || s_names[i].trim() === '') continue;

                const sType = (s_types[i] || 'NC').trim();
                const sName = s_names[i].trim();
                const sMobile = cleanMobile(s_mobiles[i]);
                const sDateInput = s_dates[i];
                
                // 🔥 FIX: If secondary date is blank, default strictly to TODAY (parseISTDateString(null)), NOT Primary Date (entryDate)
                const sEntryDate = sDateInput ? parseISTDateString(sDateInput) : parseISTDateString(null);

                let sGender = (s_genders[i] || 'KEEP').trim();
                if (sGender === 'KEEP' || sGender === '') sGender = await guessGenderAI(sName);
                else if (sGender === 'CLEAR') sGender = '';

                const sLogic = calculateLogic(sEntryDate, sType);
                let finalActDate = await getFinalActDate(sEntryDate, sType, sLogic.realActivationDate);
                let finalVerDate = sLogic.realVerificationDate;

                // Sync with primary ONLY if dates are exactly matching already
                if (p_type === 'NC' && sEntryDate.getTime() === entryDate.getTime() && pLogic.realVerificationDate > finalVerDate) {
                    finalActDate = pLogic.realActivationDate; finalVerDate = pLogic.realVerificationDate;
                }

                let secStatus = sType === 'Existing' ? 'completed' : 'pending';

                await new Customer({
                    groupId: finalGroupId,
                    name: sName, mobile: sMobile, gender: sGender, category: 'Family', subType: sType, plan: plan, region: 'NA',
                    familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                    remarks: finalRemarks || '', createdAt: sEntryDate, activationDate: finalActDate, verificationDate: finalVerDate, status: secStatus, billDate: bDate
                }).save();
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = cleanMobile(getFirst(req.body.n_mobile));
            
            let gender = getFirst(req.body.gender) || 'KEEP';
            if (gender === 'KEEP' || gender === '') gender = await guessGenderAI(n_name);
            else if (gender === 'CLEAR') gender = '';
            
            const nLogic = calculateLogic(entryDate, category);
            nLogic.realActivationDate = await getFinalActDate(entryDate, category, nLogic.realActivationDate);
            let nStatus = category === 'Existing' ? 'completed' : 'pending';
            
            const newGroupId = new mongoose.Types.ObjectId().toString();
            
            await new Customer({
                groupId: newGroupId,
                name: n_name, mobile: n_mobile, gender: gender, category: category, subType: category, plan: plan, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: nStatus, billDate: bDate
            }).save();
        }
        
        // 🔥 Trigger Success Toast
        res.cookie('hubToast', 'New Record Added Successfully! 🎉', { maxAge: 5000, httpOnly: false });
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

// ==========================================
// EDIT ROUTE
// ==========================================
router.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const getFirst = (val) => { let v = Array.isArray(val) ? val[0] : (val || ''); return typeof v === 'string' ? v.trim() : v; };
        
        const isFamGroup = req.params.id.startsWith('fam_');
        let existingDoc = null;

        if (isFamGroup) {
            const pNum = req.params.id.replace('fam_', '');
            existingDoc = await Customer.findOne({ category: 'Family', $or: [{ mobile: pNum, familyRole: 'Primary' }, { linkedPrimaryNumber: pNum }] });
        } else if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            existingDoc = await Customer.findById(req.params.id);
        }

        if (!existingDoc) return safeRedirect(req, res);

        const category = getFirst(req.body.category);
        const rawDate = getFirst(req.body.activationDate) || getFirst(req.body.customDate) || getFirst(req.body.editDate);
        const remarks = getFirst(req.body.remarks);
        const plan = getFirst(req.body.plan);
        const billDateStr = getFirst(req.body.billDate);

        const currentGroupId = existingDoc.groupId || existingDoc._id.toString();
        
        const isEditingSecondary = existingDoc.familyRole === 'Secondary';
        const newEntryDate = parseISTDateString(rawDate, existingDoc.createdAt);
        const bDate = billDateStr ? parseInt(billDateStr) : null;

        if (category === 'Family') {
            const p_type = getFirst(req.body.p_type);
            const p_mobile = cleanMobile(getFirst(req.body.p_mobile));
            let p_name = getFirst(req.body.p_name);
            
            if (!p_name || p_name.trim() === '' || p_name === p_mobile) {
                p_name = 'Primary Account'; 
            }
            
            let p_gender = getFirst(req.body.p_gender) || 'KEEP';

            let existingPrimary = await Customer.findOne({ groupId: currentGroupId, familyRole: 'Primary' });

            if (!existingPrimary && existingDoc) {
                existingPrimary = existingDoc; 
            }

            let finalRemarks = remarks;
            if ((!finalRemarks || finalRemarks.trim() === '') && existingPrimary && existingPrimary.remarks) {
                finalRemarks = existingPrimary.remarks;
            }

            let finalPGender = existingPrimary ? existingPrimary.gender : '';
            if (p_gender === 'Male' || p_gender === 'Female') { finalPGender = p_gender; } 
            else if (p_gender === 'CLEAR') { finalPGender = ''; }
            else if (p_gender === 'KEEP') {
                finalPGender = existingPrimary ? existingPrimary.gender : (await guessGenderAI(p_name));
            }

            let pLogic = null;
            let finalAct = null;
            let finalVer = null;
            
            if (!isEditingSecondary || !existingPrimary) {
                pLogic = calculateLogic(newEntryDate, p_type);
                finalAct = await getFinalActDate(newEntryDate, p_type, pLogic.realActivationDate);
                finalVer = pLogic.realVerificationDate;
            } else {
                pLogic = calculateLogic(existingPrimary.createdAt, existingPrimary.subType);
                finalAct = existingPrimary.activationDate;
                finalVer = existingPrimary.verificationDate;
            }

            const primaryUpdateData = {
                groupId: currentGroupId,
                name: p_name, mobile: p_mobile, gender: finalPGender, subType: p_type, plan: plan, 
                billDate: bDate, remarks: finalRemarks || '', 
                category: 'Family', familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                status: p_type === 'Existing' ? 'completed' : 'pending'
            };

            if (!isEditingSecondary || !existingPrimary) {
                primaryUpdateData.createdAt = newEntryDate;
                primaryUpdateData.activationDate = finalAct;
                primaryUpdateData.verificationDate = finalVer;
            }

            if (existingPrimary && existingPrimary._id) { 
                await Customer.findByIdAndUpdate(existingPrimary._id, primaryUpdateData); 
                await Customer.deleteMany({ mobile: p_mobile, _id: { $ne: existingPrimary._id }, familyRole: { $ne: 'Secondary' } });
            } else { 
                let newPrim = await new Customer(primaryUpdateData).save(); 
                await Customer.deleteMany({ mobile: p_mobile, _id: { $ne: newPrim._id }, familyRole: { $ne: 'Secondary' } });
            }

            await Customer.updateMany(
                { groupId: currentGroupId, familyRole: 'Secondary' }, 
                { linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`, plan: plan, remarks: finalRemarks || '' }
            );

            const s_ids = getArray(req.body.s_id); 
            const s_types = getArray(req.body.s_type); 
            const s_names = getArray(req.body.s_name);
            const s_mobiles = getArray(req.body.s_mobile); 
            const s_genders = getArray(req.body.s_gender);
            const s_dates = getArray(req.body.s_date);

            const validIncomingSIds = s_ids.filter(id => id && id.length > 5 && id !== 'undefined');
            await Customer.deleteMany({
                groupId: currentGroupId,
                familyRole: 'Secondary',
                _id: { $nin: validIncomingSIds }
            });

            for (let i = 0; i < s_names.length; i++) {
                let cId = s_ids[i]; 
                let cName = typeof s_names[i] === 'string' ? s_names[i].trim() : '';
                let cMobile = cleanMobile(s_mobiles[i]);
                let cType = typeof s_types[i] === 'string' ? s_types[i].trim() : 'NC';
                let cGender = typeof s_genders[i] === 'string' ? s_genders[i].trim() : 'KEEP';
                let cDateStr = s_dates[i];

                if (!cName || cName === '') {
                    if (cId && cId.length > 5 && cId !== 'undefined') await Customer.findByIdAndDelete(cId);
                    continue;
                }

                let existingSec = null;
                if (cId && cId.length > 5 && cId !== 'undefined') existingSec = await Customer.findById(cId);
                
                // 🔥 FIX: Similar fallback rule for edit mode. If blank, default to existing date. If no existing date (brand new secondary), fallback to TODAY, not primary date.
                const secEntryDate = cDateStr 
                    ? parseISTDateString(cDateStr, existingSec ? existingSec.createdAt : null) 
                    : (existingSec ? existingSec.createdAt : parseISTDateString(null));

                let finalSGender = existingSec ? existingSec.gender : '';
                if (cGender === 'Male' || cGender === 'Female') { finalSGender = cGender; } 
                else if (cGender === 'CLEAR') { finalSGender = ''; }
                else if (cGender === 'KEEP' && (!finalSGender || finalSGender.trim() === '')) {
                    finalSGender = await guessGenderAI(cName);
                }

                let secLogic = calculateLogic(secEntryDate, cType);
                let secAct = await getFinalActDate(secEntryDate, cType, secLogic.realActivationDate);
                let secVer = secLogic.realVerificationDate;
                
                if (cType !== 'Existing' && p_type !== 'Existing' && secEntryDate.getTime() === (primaryUpdateData.createdAt || existingPrimary.createdAt).getTime() && pLogic && pLogic.realVerificationDate > secVer) { 
                    secAct = pLogic.realActivationDate; secVer = pLogic.realVerificationDate; 
                }
                let secStatus = cType === 'Existing' ? 'completed' : 'pending';

                if (existingSec) {
                    await Customer.findByIdAndUpdate(cId, { 
                        groupId: currentGroupId,
                        name: cName, mobile: cMobile, gender: finalSGender, subType: cType, plan: plan, 
                        activationDate: secAct, verificationDate: secVer, linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, billDate: bDate, remarks: finalRemarks || '', createdAt: secEntryDate, status: secStatus
                    });
                } else {
                    await new Customer({
                        groupId: currentGroupId,
                        name: cName, mobile: cMobile, gender: finalSGender, category: 'Family', subType: cType, plan: plan, region: 'NA', 
                        familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, 
                        linkedPrimaryStatus: `Type: ${p_type}`, remarks: finalRemarks || '', createdAt: secEntryDate, activationDate: secAct, verificationDate: secVer, status: secStatus, billDate: bDate
                    }).save();
                }
            }
        } else {
            const n_name = getFirst(req.body.n_name);
            const n_mobile = cleanMobile(getFirst(req.body.n_mobile));
            const gender = getFirst(req.body.gender) || 'KEEP';

            let finalGender = existingDoc.gender;
            if (gender === 'Male' || gender === 'Female') { finalGender = gender; } 
            else if (gender === 'CLEAR') { finalGender = ''; }
            else if (gender === 'KEEP' && (!finalGender || finalGender.trim() === '')) {
                finalGender = await guessGenderAI(n_name);
            }

            let updateData = { 
                groupId: currentGroupId,
                category, remarks, plan, billDate: bDate,
                name: n_name, mobile: n_mobile, gender: finalGender, subType: category,
                region: 'NA', familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                status: category === 'Existing' ? 'completed' : 'pending' 
            };

            const nLogic = calculateLogic(newEntryDate, category);
            updateData.createdAt = newEntryDate; 
            updateData.activationDate = await getFinalActDate(newEntryDate, category, nLogic.realActivationDate); 
            updateData.verificationDate = nLogic.realVerificationDate;
            
            await Customer.findByIdAndUpdate(existingDoc._id, updateData);
        }
        
        // 🔥 Trigger Success Toast
        res.cookie('hubToast', 'Record Updated Successfully! ✏️', { maxAge: 5000, httpOnly: false });
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

// ==========================================
// DELETE ROUTE
// ==========================================
router.post('/delete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const isFamGroup = req.params.id.startsWith('fam_');
        
        if (isFamGroup) {
            const pNum = req.params.id.replace('fam_', '');
            const doc = await Customer.findOne({ category: 'Family', familyRole: 'Primary', mobile: pNum });
            if (doc && doc.groupId) {
                await Customer.deleteMany({ groupId: doc.groupId });
            } else {
                await Customer.deleteMany({ category: 'Family', $or: [{ mobile: pNum, familyRole: 'Primary' }, { linkedPrimaryNumber: pNum }] });
            }
        } else if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            const doc = await Customer.findById(req.params.id);
            if(doc && doc.category === 'Family' && doc.familyRole === 'Primary') {
                await Customer.deleteMany({ groupId: doc.groupId }); 
            } else if (doc) {
                await Customer.findByIdAndDelete(req.params.id); 
            }
        }
        
        // 🔥 Trigger Delete Toast
        res.cookie('hubToast', 'Record Deleted Successfully! 🗑️', { maxAge: 5000, httpOnly: false });
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

router.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { 
        let docId = req.params.id;
        if (docId.startsWith('fam_')) {
            const pNum = docId.replace('fam_', '');
            const pDoc = await Customer.findOne({ category: 'Family', familyRole: 'Primary', mobile: pNum });
            if(pDoc) docId = pDoc._id;
        }
        
        if (mongoose.Types.ObjectId.isValid(docId)) {
            const doc = await Customer.findById(docId);
            if (doc) await Customer.findByIdAndUpdate(docId, { status: 'completed' });
        }
        
        // 🔥 Trigger Done Toast
        res.cookie('hubToast', 'Verification Marked as Done! ✅', { maxAge: 5000, httpOnly: false });
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

module.exports = router;
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: String, 
    mobile: String, 
    category: String, 
    subType: String, 
    plan: { type: String, default: '451' }, 
    region: { type: String, default: 'NA' }, 
    familyRole: { type: String, default: 'Secondary' }, 
    linkedPrimaryName: String, 
    linkedPrimaryNumber: String, 
    linkedPrimaryStatus: String, 
    remarks: { type: String, default: '' },
    status: { type: String, default: 'pending' }, 
    createdAt: { type: Date, default: Date.now }, 
    activationDate: Date, 
    verificationDate: Date,
    billDate: { type: Number, default: null }, 
    paidMonths: { type: [String], default: [] },
    callLogs: [{
        callDate: { type: Date, default: Date.now },
        pageType: String,
        reason: String,
        notes: String
    }]
});

module.exports = mongoose.model('Customer', customerSchema);
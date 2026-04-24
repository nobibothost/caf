const mongoose = require('mongoose');

const CallLogSchema = new mongoose.Schema({
    callDate: { type: Date, default: Date.now },
    pageType: String,
    reason: String,
    notes: String
});

const CustomerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    mobile: { type: String, required: true },
    gender: { type: String, default: '' },
    category: { type: String, required: true },
    subType: { type: String },
    plan: { type: String },
    region: { type: String, default: 'NA' },
    familyRole: { type: String, default: '' },
    linkedPrimaryName: { type: String, default: '' },
    linkedPrimaryNumber: { type: String, default: '' },
    linkedPrimaryStatus: { type: String, default: '' },
    remarks: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    activationDate: { type: Date },
    verificationDate: { type: Date },
    status: { type: String, default: 'pending' },
    billDate: { type: Number, default: null },
    paidMonths: { type: [String], default: [] },
    callLogs: [CallLogSchema]
});

module.exports = mongoose.model('Customer', CustomerSchema);
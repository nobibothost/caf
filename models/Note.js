const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    text: { 
        type: String, 
        required: true 
    },
    category: { 
        type: String, 
        default: 'General' 
    },
    isDone: { 
        type: Boolean, 
        default: false 
    },
    customerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Customer', 
        default: null 
    },
    manualMobile: { 
        type: String, 
        default: null 
    }
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);
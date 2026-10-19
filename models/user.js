const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    pendingTasks: {
        type: [String],
        default: [],
        castNonArrays: false,
        validate: {
            validator: value => Array.isArray(value) &&
                value.every(id => /^[a-fA-F0-9]{24}$/.test(id)),
            message: 'pendingTasks must contain valid task IDs.'
        }
    },
    dateCreated: {
        type: Date,
        default: Date.now,
        immutable: true,
        // Ignore client-supplied creation dates on new documents.
        set: function (value) {
            return this.isNew ? new Date() : value;
        }
    }
});

// unique creates a database index; routes must translate duplicate-key errors.
module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    deadline: {
        type: Date,
        required: true
    },
    completed: {
        type: Boolean,
        default: false
    },
    assignedUser: {
        type: String,
        default: '',
        validate: {
            validator: value => value === '' || /^[a-fA-F0-9]{24}$/.test(value),
            message: 'assignedUser must be empty or a valid user ID.'
        }
    },
    assignedUserName: {
        type: String,
        default: 'unassigned'
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

// Reference existence and two-way synchronization are handled by the routes.
module.exports = mongoose.model('Task', taskSchema);

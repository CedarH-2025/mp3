const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('../lib/errors');
const { userInput } = require('../lib/validation');
const { list, single, getById } = require('../lib/queries');

exports.listUsers = async function (req, res) {
    res.json({ message: 'OK', data: await list(User, req.query, 0) });
};

exports.getUser = async function (req, res) {
    res.json({ message: 'OK', data: await single(User, req.params.id, req.query, 'User') });
};

async function writeUser(req, replacing) {
    return mongoose.connection.transaction(async session => {
        const user = replacing ? await getById(User, req.params.id, 'User', session) : new User();
        const input = userInput(req.body);
        const duplicate = await User.findOne({ email: input.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) throw new ApiError(400, 'This email is already in use.');
        const tasks = await Task.find({ _id: { $in: input.pendingTasks } }).session(session);
        if (tasks.length !== input.pendingTasks.length) throw new ApiError(404, 'A referenced task was not found.');
        if (tasks.some(task => task.completed)) throw new ApiError(400, 'pendingTasks cannot contain completed tasks.');

        const userId = user.id;
        const removed = user.pendingTasks.filter(id => !input.pendingTasks.includes(id));
        user.set(input);
        await user.save({ session });
        // Remove newly claimed tasks from any previous owner's pending list.
        await User.updateMany(
            { _id: { $ne: user._id }, pendingTasks: { $in: input.pendingTasks } },
            { $pull: { pendingTasks: { $in: input.pendingTasks } } }, { session }
        );
        await Task.updateMany(
            { _id: { $in: removed }, assignedUser: userId },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session }
        );
        await Task.updateMany(
            { _id: { $in: input.pendingTasks } },
            { $set: { assignedUser: userId, assignedUserName: user.name } }, { session }
        );
        // Completed tasks retain ownership and must also receive name changes.
        await Task.updateMany(
            { assignedUser: userId }, { $set: { assignedUserName: user.name } }, { session }
        );
        return user.toObject();
    });
}

exports.createUser = async function (req, res) {
    res.status(201).json({ message: 'User created.', data: await writeUser(req, false) });
};

exports.replaceUser = async function (req, res) {
    res.json({ message: 'User updated.', data: await writeUser(req, true) });
};

exports.deleteUser = async function (req, res) {
    await mongoose.connection.transaction(async session => {
        const user = await getById(User, req.params.id, 'User', session);
        await Task.updateMany(
            { assignedUser: user.id },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session }
        );
        await user.deleteOne({ session });
    });
    res.status(204).end();
};

const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('../lib/errors');
const { taskInput } = require('../lib/validation');
const { list, single, getById } = require('../lib/queries');

exports.listTasks = async function (req, res) {
    res.json({ message: 'OK', data: await list(Task, req.query, 100) });
};

exports.getTask = async function (req, res) {
    res.json({ message: 'OK', data: await single(Task, req.params.id, req.query, 'Task') });
};

async function writeTask(req, replacing) {
    return mongoose.connection.transaction(async session => {
        const task = replacing ? await getById(Task, req.params.id, 'Task', session) : new Task();
        const input = taskInput(req.body);
        let user = null;
        if (input.assignedUser) {
            user = await User.findById(input.assignedUser).session(session);
            if (!user) throw new ApiError(404, 'Assigned user not found.');
            if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) {
                throw new ApiError(400, 'assignedUserName does not match the assigned user.');
            }
        }
        input.assignedUserName = user ? user.name : 'unassigned';
        task.set(input);
        await task.save({ session });
        // Remove the old reference before adding the (possibly new) owner.
        await User.updateMany({ pendingTasks: task.id }, { $pull: { pendingTasks: task.id } }, { session });
        if (user && !task.completed) {
            await User.updateOne({ _id: user._id }, { $addToSet: { pendingTasks: task.id } }, { session });
        }
        return task.toObject();
    });
}

exports.createTask = async function (req, res) {
    res.status(201).json({ message: 'Task created.', data: await writeTask(req, false) });
};

exports.replaceTask = async function (req, res) {
    res.json({ message: 'Task updated.', data: await writeTask(req, true) });
};

exports.deleteTask = async function (req, res) {
    const data = await mongoose.connection.transaction(async session => {
        const task = await getById(Task, req.params.id, 'Task', session);
        await User.updateMany({ pendingTasks: task.id }, { $pull: { pendingTasks: task.id } }, { session });
        await task.deleteOne({ session });
        return task.toObject();
    });
    res.json({ message: 'Task deleted.', data });
};

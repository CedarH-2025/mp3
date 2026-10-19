const { ApiError } = require('./errors');

const isId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const badRequest = message => { throw new ApiError(400, message); };

function bodyObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest('Request body must be an object.');
    }
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) badRequest(`${field} must be a non-empty string.`);
    return value.trim();
}

function optionalString(body, field, fallback) {
    if (body[field] === undefined) return fallback;
    if (typeof body[field] !== 'string') badRequest(`${field} must be a string.`);
    return body[field];
}

function userInput(body) {
    bodyObject(body);
    const name = requiredString(body.name, 'name');
    const email = requiredString(body.email, 'email');
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(isId)) {
        badRequest('pendingTasks must be an array of valid task IDs.');
    }
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}

function taskInput(body) {
    bodyObject(body);
    const name = requiredString(body.name, 'name');
    if (!['string', 'number'].includes(typeof body.deadline) ||
        (typeof body.deadline === 'string' && !body.deadline.trim())) {
        badRequest('deadline must be a valid date.');
    }
    const deadline = new Date(body.deadline);
    if (Number.isNaN(deadline.getTime())) badRequest('deadline must be a valid date.');
    const description = optionalString(body, 'description', '');
    const completed = body.completed === undefined ? false : body.completed;
    if (typeof completed !== 'boolean') badRequest('completed must be a boolean.');
    const assignedUser = optionalString(body, 'assignedUser', '').toLowerCase();
    if (assignedUser !== '' && !isId(assignedUser)) badRequest('assignedUser must be empty or a valid user ID.');
    const assignedUserName = optionalString(body, 'assignedUserName', undefined);
    if (!assignedUser && assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        badRequest('An unassigned task must have assignedUserName "unassigned".');
    }
    return { name, deadline, description, completed, assignedUser, assignedUserName };
}

module.exports = { isId, userInput, taskInput };

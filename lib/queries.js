const { ApiError } = require('./errors');
const { isId } = require('./validation');

function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') throw new ApiError(400, `${key} must be a JSON value.`);
    try { return JSON.parse(query[key]); }
    catch { throw new ApiError(400, `${key} must contain valid JSON.`); }
}

function objectParameter(query, key) {
    const value = parse(query, key, {});
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, `${key} must be a JSON object.`);
    }
    return value;
}

function selectParameter(query) {
    const select = objectParameter(query, 'select');
    if (!Object.values(select).every(value => value === 0 || value === 1)) {
        throw new ApiError(400, 'select values must be 0 or 1.');
    }
    const modes = Object.entries(select).filter(([key]) => key !== '_id').map(([, value]) => value);
    if (modes.includes(0) && modes.includes(1)) {
        throw new ApiError(400, 'select cannot mix included and excluded fields except for _id.');
    }
    return select;
}

function pagination(query, key, fallback) {
    const value = parse(query, key, fallback);
    if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${key} must be a non-negative integer.`);
    return value;
}

function checkFilter(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (['$where', '$function', '$accumulator'].includes(key)) {
            throw new ApiError(400, 'Executable query expressions are not supported.');
        }
        checkFilter(child);
    }
}

async function list(Model, query, defaultLimit) {
    const where = objectParameter(query, 'where');
    checkFilter(where);
    const sort = objectParameter(query, 'sort');
    if (!Object.values(sort).every(value => value === 1 || value === -1)) {
        throw new ApiError(400, 'sort values must be 1 or -1.');
    }
    const select = selectParameter(query);
    const skip = pagination(query, 'skip', 0);
    const limit = pagination(query, 'limit', defaultLimit);
    const count = parse(query, 'count', false);
    if (typeof count !== 'boolean') throw new ApiError(400, 'count must be a boolean.');
    // Count all matches; projection and pagination only affect document results.
    if (count) return Model.countDocuments(where).exec();
    return Model.find(where).sort(sort).select(select).skip(skip).limit(limit).exec();
}

async function getById(Model, id, label, session) {
    if (!isId(id)) throw new ApiError(404, `${label} not found.`);
    const document = await Model.findById(id).session(session || null);
    if (!document) throw new ApiError(404, `${label} not found.`);
    return document;
}

async function single(Model, id, query, label) {
    // Resource existence takes priority over malformed select parameters.
    await getById(Model, id, label);
    const document = await Model.findById(id).select(selectParameter(query));
    if (!document) throw new ApiError(404, `${label} not found.`);
    return document;
}

module.exports = { list, single, getById };

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = 500;
    let message = 'An unexpected server error occurred.';
    if (error instanceof ApiError) {
        status = error.status;
        message = error.message;
    } else if (error.type === 'entity.parse.failed') {
        status = 400;
        message = 'Request body must contain valid JSON.';
    } else if (error.type === 'entity.too.large') {
        status = 400;
        message = 'Request body is too large.';
    } else if (error.code === 11000) {
        status = 400;
        message = 'This email is already in use.';
    } else if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) {
        status = 400;
        message = 'One or more fields contain invalid values.';
    } else if (error.name === 'MongoServerError' &&
        [2, 9, 14, 72, 159, 168, 31253, 31254].includes(error.code)) {
        status = 400;
        message = 'Invalid query parameters.';
    }
    res.status(status).json({ message, data: null });
}

module.exports = { ApiError, errorHandler };

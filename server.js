require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const User = require('./models/user');
const Task = require('./models/task');

async function start() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    // Prepare collections and the unique email index before accepting writes.
    await Promise.all([User.init(), Task.init()]);
    const port = process.env.PORT || 3000;
    return app.listen(port, () => console.log('Server running on port ' + port));
}

if (require.main === module) {
    start().catch(async () => {
        console.error('Unable to start server. Check database configuration and connectivity.');
        await mongoose.disconnect();
        process.exitCode = 1;
    });
}

module.exports = { start };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });
const app = require('../app');
const User = require('../models/user');
const Task = require('../models/task');

// Tests never write to the application's configured database.
const database = `mp3_test_${randomBytes(8).toString('hex')}`;
const deadline = '2026-11-03T12:00:00.000Z';
const missingId = '000000000000000000000001';

test('API integration tests against an isolated database', async t => {
    const useAtlas = process.env.MP3_TEST_ATLAS === '1';
    let replicaSet;
    let uri = process.env.MONGODB_URI;
    if (useAtlas) {
        assert(uri, 'Configure MONGODB_URI in .env before running Atlas tests.');
    } else {
        const { MongoMemoryReplSet } = require('mongodb-memory-server');
        replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        uri = replicaSet.getUri();
    }
    try {
        await mongoose.connect(uri, {
            dbName: database, serverSelectionTimeoutMS: 10000
        });
    } catch (error) {
        // Report diagnostic categories without exposing connection strings/passwords.
        const servers = error.reason?.servers;
        console.error('Database connection diagnostic:', error.name, error.code || '',
            servers ? [...servers.values()].map(server => ({
                type: server.error?.name,
                code: server.error?.code,
                causeCode: server.error?.cause?.code
            })) : []);
        await mongoose.disconnect();
        if (replicaSet) await replicaSet.stop();
        throw new Error('Test database connection failed. Check Atlas access and network connectivity.');
    }
    let server;
    try {
        await Promise.all([User.init(), Task.init()]);
        server = await new Promise(resolve => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });
        const base = `http://127.0.0.1:${server.address().port}/api`;
        async function request(method, path, body, status = 200) {
            const response = await fetch(base + path, {
                method,
                ...(body === undefined ? {} : {
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                })
            });
            const result = await response.json();
            assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
            assert.equal(typeof result.message, 'string');
            assert(Object.hasOwn(result, 'data'));
            return result.data;
        }
        const user = (name, extra = {}) => request('POST', '/users', {
            name, email: `${name}@example.com`, ...extra
        }, 201);
        const task = (name, extra = {}) => request('POST', '/tasks', { name, deadline, ...extra }, 201);
        const query = values => '?' + new URLSearchParams(
            Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])
        );
        async function run(name, body) {
            await t.test(name, async () => {
                await Task.deleteMany({});
                await User.deleteMany({});
                await body();
            });
        }

        await run('creation, defaults, replacement, and server-managed dates', async () => {
            const a = await user('Alice', { dateCreated: 'invalid' });
            assert.deepEqual(a.pendingTasks, []);
            assert(!Number.isNaN(Date.parse(a.dateCreated)));
            const item = await task('Example', { description: 'old', completed: true, dateCreated: 'invalid' });
            assert.equal(item.assignedUser, '');
            assert.equal(item.assignedUserName, 'unassigned');
            const updated = await request('PUT', `/tasks/${item._id}`, {
                name: 'New task', deadline, dateCreated: '2000-01-01'
            });
            assert.equal(updated.description, '');
            assert.equal(updated.completed, false);
            assert.equal(updated.dateCreated, item.dateCreated);
            const renamed = await request('PUT', `/users/${a._id}`, {
                name: 'New Alice', email: a.email, dateCreated: '2000-01-01'
            });
            assert.equal(renamed.dateCreated, a.dateCreated);
        });

        await run('strict body types, required fields, and duplicate emails', async () => {
            const a = await user('Alice');
            for (const body of [{}, { name: 12, email: 'a' }, { name: 'A' },
                { name: 'A', email: a.email }, { name: 'A', email: 'a', pendingTasks: null },
                { name: 'A', email: 'a', pendingTasks: ['bad'] }]) {
                await request('POST', '/users', body, 400);
            }
            for (const body of [{}, { name: 'A' }, { name: 'A', deadline: 'bad' },
                { name: 'A', deadline, completed: 'true' }, { name: 'A', deadline, description: 1 },
                { name: 'A', deadline, assignedUser: 'bad' }, { name: 'A', deadline, assignedUserName: 3 }]) {
                await request('POST', '/tasks', body, 400);
            }
            assert.equal(await User.countDocuments(), 1);
            assert.equal(await Task.countDocuments(), 0);
        });

        await run('URL IDs, referenced IDs, and error precedence', async () => {
            for (const resource of ['users', 'tasks']) {
                for (const id of ['bad', missingId]) {
                    for (const method of ['GET', 'PUT', 'DELETE']) {
                        await request(method, `/${resource}/${id}`, method === 'PUT' ? {} : undefined, 404);
                    }
                }
            }
            await request('POST', '/users', { name: 'A', email: 'a', pendingTasks: [missingId] }, 404);
            await request('POST', '/tasks', { name: 'A', deadline, assignedUser: missingId }, 404);
            await request('POST', '/tasks', { name: 'A', deadline: 'bad', assignedUser: missingId }, 400);
        });

        await run('task assignment, reassignment, completion, reopening, and unassignment', async () => {
            const a = await user('Alice');
            const b = await user('Bob');
            const item = await task('Work', { assignedUser: a._id });
            assert.equal(item.assignedUserName, a.name);
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, [item._id]);
            await request('PUT', `/tasks/${item._id}`, { name: item.name, deadline, assignedUser: b._id });
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, []);
            assert.deepEqual((await request('GET', `/users/${b._id}`)).pendingTasks, [item._id]);
            await request('PUT', `/tasks/${item._id}`, { name: item.name, deadline, assignedUser: b._id, completed: true });
            assert.deepEqual((await request('GET', `/users/${b._id}`)).pendingTasks, []);
            const completed = await request('PUT', `/tasks/${item._id}`, {
                name: item.name, deadline, assignedUser: a._id, completed: true
            });
            assert.equal(completed.assignedUser, a._id);
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, []);
            await request('PUT', `/tasks/${item._id}`, { name: item.name, deadline, assignedUser: a._id, completed: false });
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, [item._id]);
            const unassigned = await request('PUT', `/tasks/${item._id}`, { name: item.name, deadline, assignedUser: '' });
            assert.equal(unassigned.assignedUserName, 'unassigned');
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, []);
        });

        await run('user pending lists move tasks, rename all assignments, and default to empty', async () => {
            const a = await user('Alice');
            const first = await task('First', { assignedUser: a._id });
            const second = await task('Second');
            const b = await user('Bob', { pendingTasks: [first._id, second._id, first._id] });
            assert.equal(b.pendingTasks.length, 2);
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, []);
            const done = await task('Done', { assignedUser: b._id, completed: true });
            await request('PUT', `/users/${b._id}`, { name: 'Robert', email: b.email, pendingTasks: [second._id] });
            assert.equal((await request('GET', `/tasks/${first._id}`)).assignedUser, '');
            assert.equal((await request('GET', `/tasks/${second._id}`)).assignedUserName, 'Robert');
            assert.equal((await request('GET', `/tasks/${done._id}`)).assignedUserName, 'Robert');
            await request('PUT', `/users/${b._id}`, { name: 'Robert', email: b.email });
            assert.equal((await request('GET', `/tasks/${second._id}`)).assignedUser, '');
            assert.equal((await request('GET', `/tasks/${done._id}`)).assignedUser, b._id);
        });

        await run('rejected references leave all documents unchanged', async () => {
            const a = await user('Alice');
            const item = await task('Work', { assignedUser: a._id });
            const done = await task('Done', { completed: true });
            const before = JSON.stringify(await User.find().lean()) + JSON.stringify(await Task.find().lean());
            await request('PUT', `/users/${a._id}`, { name: 'Changed', email: a.email, pendingTasks: [done._id] }, 400);
            await request('PUT', `/users/${a._id}`, { name: 'Changed', email: a.email, pendingTasks: [missingId] }, 404);
            await request('PUT', `/tasks/${item._id}`, {
                name: 'Changed', deadline, assignedUser: a._id, assignedUserName: 'Wrong'
            }, 400);
            assert.equal(JSON.stringify(await User.find().lean()) + JSON.stringify(await Task.find().lean()), before);
        });

        await run('deletion removes references including completed assignments', async () => {
            const a = await user('Alice');
            const item = await task('Work', { assignedUser: a._id });
            await request('DELETE', `/tasks/${item._id}`);
            await request('GET', `/tasks/${item._id}`, undefined, 404);
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, []);
            const pending = await task('Pending', { assignedUser: a._id });
            const done = await task('Done', { assignedUser: a._id, completed: true });
            await request('DELETE', `/users/${a._id}`);
            await request('GET', `/users/${a._id}`, undefined, 404);
            for (const id of [pending._id, done._id]) {
                const result = await request('GET', `/tasks/${id}`);
                assert.equal(result.assignedUser, '');
                assert.equal(result.assignedUserName, 'unassigned');
            }
        });

        await run('combined filters, sorting, selection, pagination, and counts', async () => {
            const a = await task('Alpha');
            const b = await task('Beta');
            await task('Gamma', { completed: true });
            const results = await request('GET', '/tasks' + query({
                where: { completed: false }, sort: { name: 1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 1
            }));
            assert.deepEqual(results, [{ name: 'Beta' }]);
            assert.equal(await request('GET', '/tasks' + query({ where: { completed: false }, count: true, skip: 50, limit: 1 })), 2);
            assert.equal((await request('GET', '/tasks' + query({ where: { _id: { $in: [a._id, b._id] } } }))).length, 2);
            assert.deepEqual(await request('GET', '/tasks' + query({ where: { name: 'Missing' } })), []);
            assert.equal(await request('GET', '/tasks' + query({ where: { name: 'Missing' }, count: true })), 0);
            await user('Bob');
            await user('Alice');
            const users = await request('GET', '/users' + query({ sort: { name: 1 }, skip: 1, limit: 1, select: { name: 1, _id: 0 } }));
            assert.deepEqual(users, [{ name: 'Bob' }]);
            assert.equal(await request('GET', '/users?count=true'), 2);
        });

        await run('single-resource select ignores all other query parameters', async () => {
            const a = await user('Alice');
            const item = await task('Work');
            for (const [resource, doc] of [['users', a], ['tasks', item]]) {
                const result = await request('GET', `/${resource}/${doc._id}` + query({ select: { name: 1, _id: 0 } }) + '&where=bad&count=bad&sort=bad&skip=bad&limit=bad');
                assert.deepEqual(result, { name: doc.name });
            }
        });

        await run('bad query parameters, malformed JSON, unknown routes, and preflight', async () => {
            for (const suffix of ['?where=bad', '?sort=bad', '?select=bad', '?skip=bad', '?limit=bad', '?count=bad',
                '?limit=-1', '?skip=1.5', '?count=1', '?where=[]', '?sort={"name":0}',
                '?select={"name":1,"description":0}', '?where={"_id":"bad"}', '?limit=1&limit=2']) {
                await request('GET', '/tasks' + suffix, undefined, 400);
            }
            const raw = await fetch(base + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
            assert.equal(raw.status, 400);
            assert.equal((await raw.json()).data, null);
            await request('GET', '/missing', undefined, 404);
            const options = await fetch(base + '/tasks', { method: 'OPTIONS' });
            assert.equal(options.status, 204);
            assert.equal(options.headers.get('access-control-allow-origin'), '*');
        });

        await run('task default limit is 100 and user default is unlimited', async () => {
            await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `Task ${i}`, deadline })));
            await User.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `User ${i}`, email: `user${i}@example.com` })));
            assert.equal((await request('GET', '/tasks')).length, 100);
            assert.equal((await request('GET', '/users')).length, 105);
            assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
            assert.equal(await request('GET', '/tasks?count=true'), 105);
        });

        await run('database failures roll back earlier writes and return a safe 500', async () => {
            const a = await user('Alice');
            const item = await task('Work', { assignedUser: a._id });
            const original = Task.updateMany;
            Task.updateMany = () => { throw new Error('Simulated database failure with private internals'); };
            try {
                await request('PUT', `/users/${a._id}`, { name: 'Changed', email: a.email }, 500);
            } finally {
                Task.updateMany = original;
            }
            assert.equal((await request('GET', `/users/${a._id}`)).name, 'Alice');
            assert.equal((await request('GET', `/tasks/${item._id}`)).assignedUser, a._id);
            assert.deepEqual((await request('GET', `/users/${a._id}`)).pendingTasks, [item._id]);
        });

        await run('concurrent reassignment preserves two-way references', async () => {
            const a = await user('Alice');
            const b = await user('Bob');
            const item = await task('Work');
            await Promise.all([a, b].map(owner => request('PUT', `/users/${owner._id}`, {
                name: owner.name, email: owner.email, pendingTasks: [item._id]
            })));
            const finalTask = await request('GET', `/tasks/${item._id}`);
            for (const owner of [a, b]) {
                const result = await request('GET', `/users/${owner._id}`);
                assert.deepEqual(result.pendingTasks, owner._id === finalTask.assignedUser ? [item._id] : []);
            }
        });
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        // Only remove this run's randomly generated database.
        if (mongoose.connection.name === database && /^mp3_test_[a-f0-9]{16}$/.test(database)) {
            await mongoose.connection.dropDatabase();
        }
        await mongoose.disconnect();
        if (replicaSet) await replicaSet.stop();
    }
});

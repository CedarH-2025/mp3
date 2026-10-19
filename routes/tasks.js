const router = require('express').Router();
const tasks = require('../controllers/tasks');

router.route('/')
    .get(tasks.listTasks)
    .post(tasks.createTask);

router.route('/:id')
    .get(tasks.getTask)
    .put(tasks.replaceTask)
    .delete(tasks.deleteTask);

module.exports = router;

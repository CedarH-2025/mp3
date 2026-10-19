const router = require('express').Router();
const users = require('../controllers/users');

router.route('/')
    .get(users.listUsers)
    .post(users.createUser);

router.route('/:id')
    .get(users.getUser)
    .put(users.replaceUser)
    .delete(users.deleteUser);

module.exports = router;

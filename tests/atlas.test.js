// Reuse the same suite, with a fresh temporary database on the configured cluster.
process.env.MP3_TEST_ATLAS = '1';
require('./api.test');
